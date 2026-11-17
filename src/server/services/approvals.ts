/**
 * Customer decisions on quotations and completed work, through three channels:
 *   LINK      – a secure, expiring, single-purpose review link (no account needed);
 *   PORTAL    – a signed-in client representative of that customer;
 *   IN_PERSON – sign-off captured on a staff device with the customer's name and drawn signature;
 *   INTERNAL  – a manager records an approval received another way (phone, purchase order). Clearly labelled.
 * Exactly one decision can exist per quote version / completion version: guarded status updates plus
 * unique constraints make double-submits and races fail safely.
 * NOTE: a drawn signature is recorded as evidence of acknowledgement only. It is NOT an advanced
 * electronic signature and no legal equivalence is claimed (see SECURITY.md).
 */
import type { DecisionOutcome, DecisionVia } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { hashToken, newToken } from "@/lib/tokens";
import { isManager, jobScope, requirePerm, type Ctx } from "../permissions";
import { type Actor, actorOf, logEvent } from "./activity";
import { storeSignature } from "./attachments";
import { isAssigned, move } from "./jobs";
import { requireVerifiedEmail } from "./account";
import { managerIds, notify, queueEmail } from "./notifications";
import { appUrl } from "@/lib/app-url";

export const LINK_DAYS = 14;
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));

const decisionSchema = z.object({
  outcome: z.enum(["APPROVED", "REJECTED"]),
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  comment: z.string().trim().max(2000).default(""),
  signature: z.string().max(450_000).optional(),
}).refine((d) => d.outcome === "APPROVED" || d.comment.length >= 3, { message: "Please say why you are rejecting, so it can be put right." });
export type DecisionInput = z.input<typeof decisionSchema>;

const parseDecision = (v: unknown) => {
  const p = decisionSchema.safeParse(v);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  return p.data;
};

interface Decider {
  via: DecisionVia; userId: string | null; name: string; email: string;
  recordedById: string | null; linkId: string | null; ip: string;
}

// ---------- Core (always inside a transaction) ----------

async function decideQuote(tx: Tx, quoteId: string, d: z.output<typeof decisionSchema>, who: Decider, actor: Actor) {
  const q = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { job: true } });
  if (q.status !== "SUBMITTED") throw conflict("A decision has already been recorded for this quotation, or it has been replaced.");
  if (d.outcome === "APPROVED" && q.validUntil && endOfDay(q.validUntil) < new Date())
    throw conflict("This quotation has expired. Please ask for an updated quotation.");
  const now = new Date();
  const r = await tx.quote.updateMany({ where: { id: q.id, status: "SUBMITTED" }, data: { status: d.outcome, decidedAt: now } });
  if (r.count !== 1) throw conflict("A decision has already been recorded for this quotation.");
  await tx.decision.create({
    data: { orgId: q.orgId, jobId: q.jobId, quoteId: q.id, outcome: d.outcome, via: who.via, deciderUserId: who.userId, deciderName: who.name,
      deciderEmail: who.email, recordedById: who.recordedById, linkId: who.linkId, comment: d.comment, ipAddress: who.ip },
  });
  await tx.approvalLink.updateMany({ where: { quoteId: q.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
  if (q.kind === "ORIGINAL") await move(tx, q.orgId, q.job, d.outcome === "APPROVED" ? "APPROVED" : "QUOTING");
  const verb = d.outcome === "APPROVED" ? "approved" : "rejected";
  await logEvent(tx, actor, q.jobId, `quote.${verb}`, `Quote ${q.number} v${q.version} ${verb} by ${who.name}${VIA_NOTE[who.via]}`,
    { quoteId: q.id, via: who.via, totalCents: q.totalCents });
  await notify(tx, {
    orgId: q.orgId, jobId: q.jobId, type: `quote.${verb}`, userIds: await managerIds(tx, q.orgId), exceptUserId: who.recordedById,
    title: `Quote ${q.number} was ${verb}`, body: `${q.job.reference}: ${q.job.title}${d.comment ? `\n"${d.comment}"` : ""}`, eventKey: `quote-decided:${q.id}`,
  });
}

const VIA_NOTE: Record<DecisionVia, string> = {
  LINK: " (secure link)", PORTAL: " (customer portal)", IN_PERSON: " (signed in person)", INTERNAL: " (recorded by staff on the customer's behalf)",
};

async function decideCompletion(tx: Tx, completionId: string, d: z.output<typeof decisionSchema>, who: Decider, actor: Actor) {
  const c = await tx.completion.findUniqueOrThrow({ where: { id: completionId }, include: { job: true } });
  if (c.status !== "SUBMITTED" || c.job.status !== "AWAITING_VERIFICATION") throw conflict("A decision has already been recorded for this work.");
  const r = await tx.completion.updateMany({ where: { id: c.id, status: "SUBMITTED" }, data: { status: d.outcome } });
  if (r.count !== 1) throw conflict("A decision has already been recorded for this work.");
  const sig = d.signature ? await storeSignature(tx, { orgId: c.orgId, jobId: c.jobId, completionId: c.id, dataUrl: d.signature }) : null;
  await tx.decision.create({
    data: { orgId: c.orgId, jobId: c.jobId, completionId: c.id, outcome: d.outcome, via: who.via, deciderUserId: who.userId, deciderName: who.name,
      deciderEmail: who.email, recordedById: who.recordedById, linkId: who.linkId, comment: d.comment, ipAddress: who.ip, signatureAttachmentId: sig?.id ?? null },
  });
  await tx.approvalLink.updateMany({ where: { completionId: c.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  // Rejected work goes back to the technician; a new completion version will be needed.
  await move(tx, c.orgId, c.job, d.outcome === "APPROVED" ? "VERIFIED" : "IN_PROGRESS", d.outcome === "APPROVED" ? {} : { completedAt: null });
  const verb = d.outcome === "APPROVED" ? "approved" : "rejected";
  await logEvent(tx, actor, c.jobId, `completion.${verb}`, `Completed work (v${c.version}) ${verb} by ${who.name}${VIA_NOTE[who.via]}`,
    { completionId: c.id, via: who.via, signed: !!sig });
  await notify(tx, {
    orgId: c.orgId, jobId: c.jobId, type: `completion.${verb}`, exceptUserId: who.recordedById,
    userIds: [...(await managerIds(tx, c.orgId)), c.job.leadTechnicianId, c.submittedById],
    title: `${c.job.reference}: completed work ${verb}`, body: d.comment || c.job.title, eventKey: `completion-decided:${c.id}`,
  });
}

const dup = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A decision has already been recorded.");
    throw e;
  }
};

// ---------- Review links ----------

const linkSchema = z.object({
  recipientName: z.string().trim().min(2, "Enter the recipient's name.").max(120),
  recipientEmail: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

/** Create a review link for a SUBMITTED quote or completion. The token is returned once and never stored. */
export async function createApprovalLink(ctx: Ctx, target: { quoteId: string } | { completionId: string }, input: z.input<typeof linkSchema>) {
  requirePerm(ctx, "quoteId" in target ? "quote.manage" : "job.manage");
  requireVerifiedEmail(ctx);
  const p = linkSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const token = newToken();
  return prisma.$transaction(async (tx) => {
    let expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
    let jobId: string, subject: string, path: string, data: { quoteId: string } | { completionId: string };
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
    if ("quoteId" in target) {
      const q = await tx.quote.findFirst({ where: { id: target.quoteId, orgId: ctx.orgId, job: jobScope(ctx) }, include: { job: true } });
      if (!q) throw notFound("Quote not found.");
      if (q.status !== "SUBMITTED") throw conflict("Only a submitted quote can be sent for approval.");
      if (q.validUntil && endOfDay(q.validUntil) < expiresAt) expiresAt = endOfDay(q.validUntil);
      [jobId, subject, path, data] = [q.jobId, `Quotation ${q.number} from ${org.name} for your approval`, "q", { quoteId: q.id }];
    } else {
      const c = await tx.completion.findFirst({ where: { id: target.completionId, orgId: ctx.orgId, job: jobScope(ctx) }, include: { job: true } });
      if (!c) throw notFound("Completion not found.");
      if (c.status !== "SUBMITTED") throw conflict("This work is not awaiting verification.");
      [jobId, subject, path, data] = [c.jobId, `Please verify completed work ${c.job.reference} by ${org.name}`, "v", { completionId: c.id }];
    }
    const link = await tx.approvalLink.create({
      data: { orgId: ctx.orgId, purpose: "quoteId" in data ? "QUOTE" : "COMPLETION", ...data, tokenHash: hashToken(token),
        recipientName: p.data.recipientName, recipientEmail: p.data.recipientEmail, createdById: ctx.userId, expiresAt },
    });
    const url = `${appUrl()}/${path}/${token}`;
    await queueEmail(tx, {
      orgId: ctx.orgId, to: p.data.recipientEmail, subject, dedupeKey: `link:${link.id}`,
      body: `Dear ${p.data.recipientName},\n\n${org.name} has asked you to review this online:\n${url}\n\nThe link is personal to you and expires on ${expiresAt.toDateString()}.`,
    });
    await logEvent(tx, actorOf(ctx), jobId, "link.sent", `Secure review link sent to ${p.data.recipientName} <${p.data.recipientEmail}>`, { linkId: link.id, purpose: link.purpose });
    return { id: link.id, token, url, expiresAt };
  });
}

export async function revokeApprovalLink(ctx: Ctx, linkId: string) {
  requirePerm(ctx, "quote.manage");
  await prisma.approvalLink.updateMany({ where: { id: linkId, orgId: ctx.orgId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** What the public review page may show. Returns null for unknown or revoked links (indistinguishable to the caller). */
export async function getLinkView(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = await prisma.approvalLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      quote: { include: { lines: { orderBy: { position: "asc" } }, decision: true, job: { include: { client: true, site: true } } } },
      completion: { include: { decision: true, job: { include: { client: true, site: true } } } },
    },
  });
  if (!link || (link.revokedAt && !link.usedAt)) return null;
  const subject = link.quote ?? link.completion!;
  const job = subject.job;
  const [org, attachments] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: link.orgId }, select: { name: true, brandColour: true, logoAttachmentId: true, phone: true, contactEmail: true, vatNumber: true, vatRegistered: true } }),
    prisma.attachment.findMany({
      where: { orgId: link.orgId, ...(link.quoteId ? { quoteId: link.quoteId } : { completionId: link.completionId }), kind: { not: "SIGNATURE" } },
      select: { id: true, filename: true, mimeType: true, kind: true }, orderBy: { createdAt: "asc" },
    }),
  ]);
  const pending = subject.status === "SUBMITTED";
  const state: "open" | "decided" | "expired" = !pending ? "decided" : link.expiresAt < new Date() ? "expired" : "open";
  return {
    state, purpose: link.purpose, recipientName: link.recipientName, expiresAt: link.expiresAt, org,
    job: { reference: job.reference, title: job.title, description: job.description, clientName: job.client.name, siteName: job.site.name },
    quote: link.quote && { number: link.quote.number, version: link.quote.version, kind: link.quote.kind, scope: link.quote.scope, terms: link.quote.terms,
      validUntil: link.quote.validUntil, vatRateBps: link.quote.vatRateBps, subtotalCents: link.quote.subtotalCents, vatCents: link.quote.vatCents,
      totalCents: link.quote.totalCents, status: link.quote.status,
      lines: link.quote.lines.map((l) => ({ id: l.id, kind: l.kind, description: l.description, quantity: l.quantity.toString(), unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, taxable: l.taxable })) },
    completion: link.completion && { version: link.completion.version, workPerformed: link.completion.workPerformed, observations: link.completion.observations,
      completedAt: link.completion.completedAt, status: link.completion.status },
    decision: subject.decision && { outcome: subject.decision.outcome, deciderName: subject.decision.deciderName, createdAt: subject.decision.createdAt },
    attachments,
  };
}

/**
 * Record a decision through a review link. The link is claimed atomically (single use), must be unexpired
 * and unrevoked, and can only ever decide the one quote/completion it was issued for.
 */
export async function decideViaLink(token: string, input: DecisionInput, ip = "") {
  const d = parseDecision(input);
  return dup(() => prisma.$transaction(async (tx) => {
    const link = await tx.approvalLink.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || link.revokedAt) throw notFound("This link is not valid.");
    if (link.usedAt) throw conflict("This link has already been used to record a decision.");
    if (link.expiresAt < new Date()) throw conflict("This link has expired. Please ask for a new one.");
    const claimed = await tx.approvalLink.updateMany({ where: { id: link.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw conflict("This link has already been used to record a decision.");
    const who: Decider = { via: "LINK", userId: null, name: d.name, email: link.recipientEmail, recordedById: null, linkId: link.id, ip };
    const actor: Actor = { orgId: link.orgId, userId: null, label: `${d.name} (customer, via secure link)` };
    if (link.purpose === "QUOTE") await decideQuote(tx, link.quoteId!, d, who, actor);
    else await decideCompletion(tx, link.completionId!, d, who, actor);
    return { outcome: d.outcome as DecisionOutcome };
  }));
}

// ---------- Signed-in channels ----------

/** A signed-in client representative decides a quote for THEIR customer organisation. */
export async function portalDecideQuote(ctx: Ctx, quoteId: string, input: Omit<DecisionInput, "name">, ip = "") {
  requirePerm(ctx, "customer.decide");
  const d = parseDecision({ ...input, name: ctx.userName });
  return dup(() => prisma.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId, job: jobScope(ctx) } });
    if (!q || !ctx.clientId) throw notFound("Quote not found.");
    await decideQuote(tx, q.id, d, { via: "PORTAL", userId: ctx.userId, name: ctx.userName, email: ctx.userEmail, recordedById: null, linkId: null, ip }, actorOf(ctx));
  }));
}

export async function portalDecideCompletion(ctx: Ctx, completionId: string, input: Omit<DecisionInput, "name">, ip = "") {
  requirePerm(ctx, "customer.decide");
  const d = parseDecision({ ...input, name: ctx.userName });
  return dup(() => prisma.$transaction(async (tx) => {
    const c = await tx.completion.findFirst({ where: { id: completionId, orgId: ctx.orgId, job: jobScope(ctx) } });
    if (!c || !ctx.clientId) throw notFound("Not found.");
    await decideCompletion(tx, c.id, d, { via: "PORTAL", userId: ctx.userId, name: ctx.userName, email: ctx.userEmail, recordedById: null, linkId: null, ip }, actorOf(ctx));
  }));
}

/** A manager records a quote decision the customer gave another way. The audit trail says so explicitly. */
export async function recordQuoteDecision(ctx: Ctx, quoteId: string, input: DecisionInput) {
  requirePerm(ctx, "quote.manage");
  const d = parseDecision(input);
  if (d.comment.length < 3) throw invalid("Record how the customer gave this decision (e.g. PO number, phone call).");
  return dup(() => prisma.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId, job: jobScope(ctx) } });
    if (!q) throw notFound("Quote not found.");
    await decideQuote(tx, q.id, d, { via: "INTERNAL", userId: null, name: d.name, email: "", recordedById: ctx.userId, linkId: null, ip: "" }, actorOf(ctx));
  }));
}

/** Customer signs off on a staff member's device: their name and a drawn signature are mandatory. */
export async function captureSignoff(ctx: Ctx, completionId: string, input: DecisionInput) {
  requirePerm(ctx, "signoff.capture");
  const d = parseDecision(input);
  if (!d.signature) throw invalid("The customer's signature is required.");
  return dup(() => prisma.$transaction(async (tx) => {
    const c = await tx.completion.findFirst({ where: { id: completionId, orgId: ctx.orgId, job: jobScope(ctx) }, include: { job: { include: { technicians: true } } } });
    if (!c) throw notFound("Not found.");
    if (!isManager(ctx) && !isAssigned(c.job, ctx.userId)) throw forbidden("You are not assigned to this job.");
    await decideCompletion(tx, c.id, d, { via: "IN_PERSON", userId: null, name: d.name, email: "", recordedById: ctx.userId, linkId: null, ip: "" }, actorOf(ctx));
  }));
}
