/**
 * Contractor quotations RECEIVED by the site.
 *  - A manager requests quotes from one or more contractors (each gets a secure link; see contractor-links.ts).
 *  - Quotes arrive through the contractor's link, or staff capture a quote that came by email/paper.
 *  - Each contractor has one live quote per job; a revision is a new version (earlier versions are kept, frozen).
 *  - Amounts are integer cents: price excl. VAT, VAT at 15% only if the contractor is VAT registered.
 * Choosing / approving a quote is in approvals.ts.
 */
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { computeTotals } from "@/lib/money";
import { can, jobScope, requirePerm, type Ctx } from "../permissions";
import { actorOf, type Actor, logEvent } from "./activity";
import { requireVerifiedEmail } from "./account";
import { issueQuoteLink, revokeJobLinks } from "./contractor-links";
import { loadJob, move } from "./jobs";
import { managerIds, notify } from "./notifications";

export const SA_VAT_BPS = 1500;
const optDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable());

const requestSchema = z.object({
  contractorIds: z.array(z.string().uuid()).min(1, "Choose at least one contractor.").max(10, "Choose up to 10 contractors."),
  scope: z.string().trim().min(5, "Describe the work you need quoted.").max(5000),
  deadline: optDate,
});

/**
 * ASSESSED → QUOTING (route CONTRACTOR) and invite contractors; or invite more contractors while QUOTING.
 * Returns one link per contractor (shown once; also emailed).
 */
export async function requestQuotes(ctx: Ctx, jobId: string, input: z.input<typeof requestSchema>) {
  requirePerm(ctx, "quote.manage");
  requireVerifiedEmail(ctx); // quote requests email people outside the organisation
  const p = requestSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  if (d.deadline && d.deadline.getTime() < Date.now() - 86_400_000) throw invalid("The quote deadline is in the past.");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    const ids = [...new Set(d.contractorIds)];
    const found = await tx.contractor.findMany({ where: { id: { in: ids }, orgId: ctx.orgId, active: true } });
    if (found.length !== ids.length) throw invalid("Choose active contractors from your directory.");
    if (job.status === "ASSESSED" || (job.status === "NEW" && job.emergency)) {
      if (job.status === "NEW") { await move(tx, ctx.orgId, job, "ASSESSING", { ownerId: job.ownerId ?? ctx.userId }); job.status = "ASSESSING"; await move(tx, ctx.orgId, job, "ASSESSED"); job.status = "ASSESSED"; }
      await move(tx, ctx.orgId, job, "QUOTING", { route: "CONTRACTOR", quoteDeadline: d.deadline, ownerId: job.ownerId ?? ctx.userId });
    } else if (job.status === "QUOTING") {
      if (d.deadline) await tx.job.update({ where: { id: job.id }, data: { quoteDeadline: d.deadline } });
    } else throw conflict("Quotes can be requested once the fault has been assessed.");
    const links = [];
    for (const c of found) {
      const r = await issueQuoteLink(tx, ctx, { ...job, quoteDeadline: d.deadline ?? job.quoteDeadline }, c.id, d.scope);
      links.push({ contractorId: c.id, contractorName: c.name, url: r.url });
    }
    await logEvent(tx, actorOf(ctx), job.id, "rfq.requested", `Quotes requested from ${found.map((c) => c.name).join(", ")}`, { contractorIds: ids });
    return links;
  });
}

export interface QuoteFigures {
  scope: string; priceExclVatCents: number; leadTimeDays?: number | null; validUntil?: Date | null; terms?: string;
}
const figuresSchema = z.object({
  scope: z.string().trim().min(3, "Describe what the quote covers.").max(5000),
  priceExclVatCents: z.number().int().min(1, "Enter the quoted price.").max(2_000_000_000),
  leadTimeDays: z.number().int().min(0).max(3650).nullish(),
  validUntil: z.date().nullish(),
  terms: z.string().trim().max(3000).default(""),
});

/** Shared by staff capture and the contractor link. Creates a SUBMITTED, frozen quote (new version per contractor). */
export async function insertContractorQuote(tx: Tx, actor: Actor, job: { id: string; reference: string; title: string; orgId: string; status: string }, contractorId: string, input: QuoteFigures, viaLink: boolean, createdById: string) {
  const p = figuresSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  if (job.status !== "QUOTING") throw conflict("This job is no longer collecting quotes.");
  if (d.validUntil && d.validUntil.getTime() < Date.now() - 86_400_000) throw invalid("The quote's validity date is in the past.");
  const contractor = await tx.contractor.findFirstOrThrow({ where: { id: contractorId, orgId: job.orgId } });
  const vatRateBps = contractor.vatRegistered ? SA_VAT_BPS : 0;
  const totals = computeTotals([{ lineTotalCents: d.priceExclVatCents, taxable: true }], vatRateBps);
  const previous = await tx.quote.findFirst({ where: { jobId: job.id, contractorId }, orderBy: { version: "desc" } });
  if (previous?.status === "APPROVED") throw conflict("This contractor's quote has already been accepted.");
  if (previous && previous.status === "SUBMITTED") {
    const r = await tx.quote.updateMany({ where: { id: previous.id, status: "SUBMITTED" }, data: { status: "SUPERSEDED" } });
    if (r.count !== 1) throw conflict("This quote was just decided. Refresh and try again.");
  }
  const number = previous?.number ?? `Q-${String((await tx.organisation.update({ where: { id: job.orgId }, data: { quoteSeq: { increment: 1 } } })).quoteSeq).padStart(5, "0")}`;
  const q = await tx.quote.create({
    data: {
      orgId: job.orgId, jobId: job.id, contractorId, number, version: (previous?.version ?? 0) + 1, status: "DRAFT",
      scope: d.scope, terms: d.terms, validUntil: d.validUntil ?? null, leadTimeDays: d.leadTimeDays ?? null, vatRateBps, viaLink, createdById,
      ...totals,
    },
  });
  await tx.quoteLine.create({
    data: { orgId: job.orgId, quoteId: q.id, position: 0, kind: "OTHER", description: "Quoted price", quantity: 1, unitPriceCents: d.priceExclVatCents, taxable: true, lineTotalCents: d.priceExclVatCents },
  });
  await tx.quote.update({ where: { id: q.id }, data: { status: "SUBMITTED", submittedAt: new Date() } }); // frozen from here (DB trigger)
  await logEvent(tx, actor, job.id, previous ? "quote.revised" : "quote.received",
    `${previous ? "Revised quote" : "Quote"} ${number}${previous ? ` v${q.version}` : ""} received from ${contractor.name}${viaLink ? " (submitted online)" : " (captured by staff)"}`,
    { quoteId: q.id, totalCents: totals.totalCents, contractorId });
  await notify(tx, {
    orgId: job.orgId, jobId: job.id, type: "quote.received", userIds: await managerIds(tx, job.orgId), exceptUserId: actor.userId,
    title: `${job.reference}: quote received from ${contractor.name}`, body: job.title, eventKey: `quote-received:${q.id}`,
  });
  return { ...q, status: "SUBMITTED" as const, contractor };
}

/** Staff capture a quote received by email/paper (attach the document separately). */
export async function recordQuote(ctx: Ctx, jobId: string, contractorId: string, input: QuoteFigures) {
  requirePerm(ctx, "quote.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    // A quote already received by email/phone can start the quoting stage directly (no link is sent).
    if (job.status === "ASSESSED") { await move(tx, ctx.orgId, job, "QUOTING", { route: "CONTRACTOR", ownerId: job.ownerId ?? ctx.userId }); job.status = "QUOTING"; }
    return insertContractorQuote(tx, actorOf(ctx), job, contractorId, input, false, ctx.userId);
  });
}

/** Stop waiting for one contractor (their quote link stops working; an existing quote is withdrawn). */
export async function withdrawInvite(ctx: Ctx, jobId: string, contractorId: string) {
  requirePerm(ctx, "quote.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (job.status !== "QUOTING") throw conflict("This job is no longer collecting quotes.");
    await revokeJobLinks(tx, ctx.orgId, job.id, "QUOTE", contractorId);
    await tx.quote.updateMany({ where: { jobId: job.id, contractorId, status: "SUBMITTED" }, data: { status: "WITHDRAWN" } });
    const c = await tx.contractor.findFirstOrThrow({ where: { id: contractorId, orgId: ctx.orgId } });
    await logEvent(tx, actorOf(ctx), job.id, "rfq.withdrawn", `Stopped waiting for a quote from ${c.name}`);
  });
}

/** Live quotes for a job, cheapest first, plus who was asked and has not responded yet. */
export async function compareQuotes(ctx: Ctx, jobId: string) {
  requirePerm(ctx, "quote.view");
  const job = await prisma.job.findFirst({ where: { id: jobId, ...jobScope(ctx) }, select: { id: true, status: true, recommendedQuoteId: true } });
  if (!job) throw notFound("Job not found.");
  const [quotes, invited, org] = await Promise.all([
    prisma.quote.findMany({
      where: { jobId, orgId: ctx.orgId, contractorId: { not: null }, status: { in: ["SUBMITTED", "APPROVED", "REJECTED"] } },
      include: { contractor: true, decision: true }, orderBy: { totalCents: "asc" },
    }),
    prisma.contractorLink.findMany({ where: { jobId, orgId: ctx.orgId, purpose: "QUOTE" }, include: { contractor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { minQuotes: true, multiQuoteThresholdCents: true, managerApprovalLimitCents: true, approverApprovalLimitCents: true, poRequired: true } }),
  ]);
  const quoted = new Set(quotes.map((q) => q.contractorId));
  const seen = new Set<string>();
  const waitingFor = invited.filter((l) => !quoted.has(l.contractorId) && !l.revokedAt && !seen.has(l.contractorId) && seen.add(l.contractorId)).map((l) => ({ ...l.contractor, expiresAt: l.expiresAt }));
  const attachments = await prisma.attachment.findMany({ where: { orgId: ctx.orgId, quoteId: { in: quotes.map((q) => q.id) } }, select: { id: true, quoteId: true, filename: true, mimeType: true } });
  return { job, quotes: quotes.map((q) => ({ ...q, files: attachments.filter((a) => a.quoteId === q.id) })), waitingFor, rules: org };
}

export async function getQuote(ctx: Ctx, quoteId: string) {
  requirePerm(ctx, "quote.view");
  if (!z.string().uuid().safeParse(quoteId).success) throw notFound("Quote not found.");
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, orgId: ctx.orgId, job: jobScope(ctx) },
    include: { lines: { orderBy: { position: "asc" } }, decision: true, contractor: true, job: { select: { id: true, reference: true, title: true, status: true, site: { select: { name: true } } } } },
  });
  if (!q) throw notFound("Quote not found.");
  const [versions, attachments] = await Promise.all([
    prisma.quote.findMany({ where: { orgId: ctx.orgId, jobId: q.jobId, number: q.number }, select: { id: true, version: true, status: true, totalCents: true, createdAt: true }, orderBy: { version: "desc" } }),
    prisma.attachment.findMany({ where: { orgId: ctx.orgId, quoteId: q.id }, select: { id: true, filename: true, mimeType: true } }),
  ]);
  return { ...q, versions, attachments, canManage: can(ctx, "quote.manage") };
}

export async function listQuotes(ctx: Ctx, f: { status?: string } = {}) {
  requirePerm(ctx, "quote.view");
  const statuses = ["SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const;
  const status = statuses.find((s) => s === f.status);
  return prisma.quote.findMany({
    where: { orgId: ctx.orgId, job: jobScope(ctx), contractorId: { not: null }, ...(status ? { status } : { status: { not: "DRAFT" } }) },
    select: {
      id: true, number: true, version: true, status: true, totalCents: true, validUntil: true, submittedAt: true, createdAt: true, leadTimeDays: true,
      contractor: { select: { name: true } }, job: { select: { id: true, reference: true, title: true, status: true, site: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" }, take: 200,
  });
}
