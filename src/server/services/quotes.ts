/**
 * Quotations. Key rules (see WORKFLOWS.md, DATABASE.md):
 *  - Only DRAFT quotes are editable. Submitting freezes the content (also enforced by DB triggers).
 *  - A revision is a NEW row (same number, version + 1); earlier versions are kept forever.
 *  - Totals are always computed on the server from the line items (src/lib/money.ts).
 *  - ORIGINAL quotes drive the job status; VARIATION quotes cover additional work on a job already under way.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conflict, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { computeTotals, lineTotalCents, parseQuantityMilli } from "@/lib/money";
import { can, jobScope, requirePerm, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";
import { loadJob, move } from "./jobs";
import { clientRepIds, notify } from "./notifications";

const lineSchema = z.object({
  kind: z.enum(["LABOUR", "MATERIAL", "OTHER"]),
  description: z.string().trim().min(1, "Every line needs a description.").max(500),
  quantity: z.string(),
  unitPriceCents: z.number().int().min(0).max(2_000_000_000),
  taxable: z.boolean().default(true),
});
const saveSchema = z.object({
  scope: z.string().trim().max(5000).default(""),
  terms: z.string().trim().max(5000).default(""),
  validUntil: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
  lines: z.array(lineSchema).max(200),
});
export type QuoteLineInput = z.input<typeof lineSchema>;

/** Start a quote (v1). ORIGINAL: job must be ASSESSED → QUOTING. VARIATION: job must be under way. */
export async function createQuote(ctx: Ctx, jobId: string, kind: "ORIGINAL" | "VARIATION" = "ORIGINAL") {
  requirePerm(ctx, "quote.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (kind === "ORIGINAL") {
      if (job.status !== "ASSESSED") throw conflict("A quotation can be started once the request has been assessed.");
      await move(tx, ctx.orgId, job, "QUOTING", { ownerId: job.ownerId ?? ctx.userId });
    } else if (!["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(job.status))
      throw conflict("A variation quote is for additional work on a job that is already under way.");
    const org = await tx.organisation.update({ where: { id: ctx.orgId }, data: { quoteSeq: { increment: 1 } } });
    const q = await tx.quote.create({
      data: {
        orgId: ctx.orgId, jobId: job.id, number: `Q-${String(org.quoteSeq).padStart(5, "0")}`, kind, createdById: ctx.userId,
        terms: org.quoteTerms, vatRateBps: org.vatRegistered ? org.vatRateBps : 0,
        validUntil: new Date(Date.now() + org.quoteValidityDays * 86_400_000),
      },
    });
    await logEvent(tx, actorOf(ctx), job.id, "quote.created", `${kind === "VARIATION" ? "Variation quote" : "Quote"} ${q.number} started`, { quoteId: q.id });
    return q;
  });
}

/** Replace the content of a DRAFT quote and recompute totals. */
export async function saveQuote(ctx: Ctx, quoteId: string, input: z.input<typeof saveSchema>) {
  requirePerm(ctx, "quote.manage");
  const p = saveSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  return prisma.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId } });
    if (!q) throw notFound("Quote not found.");
    if (q.status !== "DRAFT") throw conflict("This quote has been submitted and can no longer be edited. Create a revision instead.");
    const lines = d.lines.map((l, i) => {
      const milli = parseQuantityMilli(l.quantity);
      return {
        orgId: ctx.orgId, quoteId: q.id, position: i, kind: l.kind, description: l.description, taxable: l.taxable,
        quantity: new Prisma.Decimal(milli.toString()).div(1000), unitPriceCents: l.unitPriceCents,
        lineTotalCents: lineTotalCents(milli, l.unitPriceCents),
      };
    });
    const totals = computeTotals(lines, q.vatRateBps);
    await tx.quoteLine.deleteMany({ where: { quoteId: q.id } });
    await tx.quoteLine.createMany({ data: lines });
    // Guarded on status so a concurrent submit cannot be overwritten.
    const r = await tx.quote.updateMany({ where: { id: q.id, status: "DRAFT" }, data: { scope: d.scope, terms: d.terms, validUntil: d.validUntil, ...totals } });
    if (r.count !== 1) throw conflict("This quote was submitted while you were editing.");
    return totals;
  });
}

/** DRAFT → SUBMITTED (frozen). For an ORIGINAL quote the job moves to AWAITING_APPROVAL. */
export async function submitQuote(ctx: Ctx, quoteId: string) {
  requirePerm(ctx, "quote.manage");
  try {
    return await prisma.$transaction(async (tx) => {
      const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId }, include: { lines: true } });
      if (!q) throw notFound("Quote not found.");
      if (q.lines.length === 0) throw invalid("Add at least one line item before submitting.");
      if (!q.scope.trim()) throw invalid("Describe the scope of work before submitting.");
      if (q.validUntil && q.validUntil < new Date()) throw invalid("The validity date is in the past.");
      const totals = computeTotals(q.lines, q.vatRateBps);
      const r = await tx.quote.updateMany({ where: { id: q.id, status: "DRAFT" }, data: { ...totals, status: "SUBMITTED", submittedAt: new Date() } });
      if (r.count !== 1) throw conflict("This quote has already been submitted.");
      const job = await loadJob(tx, ctx, q.jobId);
      if (q.kind === "ORIGINAL") await move(tx, ctx.orgId, job, "AWAITING_APPROVAL");
      else if (!["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(job.status)) throw conflict("This job is no longer under way.");
      await logEvent(tx, actorOf(ctx), job.id, q.version > 1 ? "quote.revised" : "quote.submitted",
        `Quote ${q.number} v${q.version} submitted for approval`, { quoteId: q.id, totalCents: totals.totalCents });
      await notify(tx, {
        orgId: ctx.orgId, jobId: job.id, type: "quote.needs_approval", userIds: await clientRepIds(tx, ctx.orgId, job.clientId),
        title: `Quotation ${q.number} needs your approval`, body: `${job.reference}: ${job.title}`, eventKey: `quote-submitted:${q.id}`,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("Another quote for this job is already awaiting approval.");
    throw e;
  }
}

/**
 * Create the next version as a new DRAFT, copying the content. A SUBMITTED predecessor becomes SUPERSEDED
 * and its review links are revoked; a REJECTED one stays as the historical record. APPROVED quotes cannot be revised.
 */
export async function reviseQuote(ctx: Ctx, quoteId: string) {
  requirePerm(ctx, "quote.manage");
  try {
    return await prisma.$transaction(async (tx) => {
      const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId }, include: { lines: true } });
      if (!q) throw notFound("Quote not found.");
      if (q.status !== "SUBMITTED" && q.status !== "REJECTED") throw conflict("Only a submitted or rejected quote can be revised.");
      const job = await loadJob(tx, ctx, q.jobId);
      if (q.status === "SUBMITTED") {
        const r = await tx.quote.updateMany({ where: { id: q.id, status: "SUBMITTED" }, data: { status: "SUPERSEDED" } });
        if (r.count !== 1) throw conflict("This quote was just decided. Refresh and try again.");
        await tx.approvalLink.updateMany({ where: { quoteId: q.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        if (q.kind === "ORIGINAL") await move(tx, ctx.orgId, job, "QUOTING");
      } else if (q.kind === "ORIGINAL" && job.status !== "QUOTING") throw conflict("This job is no longer waiting for a quotation.");
      const org = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
      const next = await tx.quote.create({
        data: {
          orgId: ctx.orgId, jobId: q.jobId, number: q.number, version: q.version + 1, kind: q.kind, createdById: ctx.userId,
          scope: q.scope, terms: q.terms, vatRateBps: q.vatRateBps, subtotalCents: q.subtotalCents, vatCents: q.vatCents, totalCents: q.totalCents,
          validUntil: new Date(Date.now() + org.quoteValidityDays * 86_400_000),
        },
      });
      await tx.quoteLine.createMany({ data: q.lines.map(({ id: _id, ...l }) => ({ ...l, quoteId: next.id })) });
      await logEvent(tx, actorOf(ctx), job.id, "quote.revision_started", `Revision v${next.version} of quote ${q.number} started`, { quoteId: next.id, previousId: q.id });
      return next;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A newer version of this quote already exists.");
    throw e;
  }
}

export async function getQuote(ctx: Ctx, quoteId: string) {
  requirePerm(ctx, "quote.view");
  if (!z.string().uuid().safeParse(quoteId).success) throw notFound("Quote not found.");
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, orgId: ctx.orgId, job: jobScope(ctx), ...(can(ctx, "quote.manage") || ctx.support ? {} : { status: { notIn: ["DRAFT", "WITHDRAWN"] } }) },
    include: {
      lines: { orderBy: { position: "asc" } }, decision: true,
      job: { select: { id: true, reference: true, title: true, status: true, client: { select: { name: true, contactName: true, email: true } }, site: { select: { name: true } } } },
      links: { where: { revokedAt: null }, select: { id: true, recipientName: true, recipientEmail: true, expiresAt: true, usedAt: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!q) throw notFound("Quote not found.");
  const [versions, attachments] = await Promise.all([
    prisma.quote.findMany({ where: { orgId: ctx.orgId, jobId: q.jobId, number: q.number }, select: { id: true, version: true, status: true, totalCents: true, createdAt: true }, orderBy: { version: "desc" } }),
    prisma.attachment.findMany({ where: { orgId: ctx.orgId, quoteId: q.id }, select: { id: true, filename: true, mimeType: true } }),
  ]);
  return { ...q, versions: can(ctx, "quote.manage") || ctx.support ? versions : versions.filter((v) => v.status !== "DRAFT" && v.status !== "WITHDRAWN"), attachments };
}

export async function listQuotes(ctx: Ctx, f: { status?: string } = {}) {
  requirePerm(ctx, "quote.view");
  const statuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const;
  const status = statuses.find((s) => s === f.status);
  const hidden = can(ctx, "quote.manage") || ctx.support ? [] : (["DRAFT", "WITHDRAWN"] as const);
  return prisma.quote.findMany({
    where: { orgId: ctx.orgId, job: jobScope(ctx), ...(status ? { status } : {}), NOT: { status: { in: [...hidden] } } },
    select: {
      id: true, number: true, version: true, kind: true, status: true, totalCents: true, validUntil: true, submittedAt: true, createdAt: true,
      job: { select: { id: true, reference: true, title: true, client: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" }, take: 200,
  });
}
