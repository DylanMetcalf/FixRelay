/**
 * Spending approval for contractor quotes (see WORKFLOWS.md "Approvals").
 *  - Authority by amount (incl. VAT): maintenance manager ≤ managerApprovalLimit; approver ≤ approverApprovalLimit
 *    (unlimited if not set); owner unlimited. Site restrictions apply.
 *  - Above multiQuoteThreshold, at least `minQuotes` quotes from different contractors are needed, otherwise a
 *    written exception reason is recorded.
 *  - PO number required when the organisation sets poRequired.
 *  - Approving = accepting the quote: the contractor is appointed (job → ASSIGNED), receives a completion link,
 *    and the other contractors are told they were not selected. One decision per quote (DB unique), guarded updates.
 */
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { formatZar } from "@/lib/money";
import { approvalLimit, jobScope, requirePerm, type ApprovalRules, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";
import { issueCompletionLink, revokeJobLinks } from "./contractor-links";
import { move } from "./jobs";
import { managerIds, notify, queueEmail } from "./notifications";

const opts = z.object({
  poNumber: z.string().trim().max(60).default(""),
  exceptionReason: z.string().trim().max(1000).default(""),
  comment: z.string().trim().max(2000).default(""),
});
export type ApproveInput = z.input<typeof opts>;
const parse = (v: unknown) => { const p = opts.safeParse(v); if (!p.success) throw invalid(p.error.issues[0]!.message); return p.data; };

const dup = async <T>(fn: () => Promise<T>) => {
  try { return await fn(); } catch (e) { if (isUniqueViolation(e)) throw conflict("A decision has already been recorded for this quote."); throw e; }
};

async function loadForDecision(tx: Tx, ctx: Ctx, quoteId: string) {
  if (!z.string().uuid().safeParse(quoteId).success) throw notFound("Quote not found.");
  const q = await tx.quote.findFirst({ where: { id: quoteId, orgId: ctx.orgId, contractorId: { not: null }, job: jobScope(ctx) }, include: { job: true, contractor: true } });
  if (!q) throw notFound("Quote not found.");
  const org = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
  return { q, job: q.job, contractor: q.contractor!, org };
}

/** Number of different contractors with a live quote on the job. */
export const quoteCount = async (tx: Tx, jobId: string) =>
  new Set((await tx.quote.findMany({ where: { jobId, contractorId: { not: null }, status: { in: ["SUBMITTED", "APPROVED", "REJECTED"] } }, select: { contractorId: true } })).map((q) => q.contractorId)).size;

/** Throws unless the multi-quote rule is met or an exception reason is given. Returns the reason to record. */
function checkQuoteRule(org: { minQuotes: number; multiQuoteThresholdCents: number }, totalCents: number, count: number, reason: string) {
  if (totalCents <= org.multiQuoteThresholdCents || count >= org.minQuotes) return null;
  if (reason.length < 10)
    throw invalid(`Quotes above ${formatZar(org.multiQuoteThresholdCents)} need ${org.minQuotes} quotes (you have ${count}). Give a reason for going ahead with fewer (e.g. specialist supplier, emergency).`);
  return reason;
}

/** Members who may approve this amount at this site (owners always). */
export async function approverIdsFor(tx: Tx, orgId: string, siteId: string, amountCents: number) {
  const org = await tx.organisation.findUniqueOrThrow({ where: { id: orgId } });
  const ms = await tx.membership.findMany({ where: { orgId, active: true, roles: { hasSome: ["OWNER", "APPROVER", "MANAGER"] } }, include: { user: { select: { name: true, email: true } } } });
  return ms.filter((m) => (!m.siteIds.length || m.siteIds.includes(siteId))
    && approvalLimit({ roles: m.roles, support: false, locked: false } as unknown as Ctx, org) >= amountCents).map((m) => m.userId);
}

export const limitOf = (ctx: Ctx, rules: ApprovalRules) => approvalLimit(ctx, rules);

/**
 * Accept a quote within the caller's authority. Works from QUOTING (manager/approver choosing directly) or
 * AWAITING_APPROVAL (approving the recommended quote). Appoints the contractor.
 */
export async function approveQuote(ctx: Ctx, quoteId: string, input: ApproveInput) {
  requirePerm(ctx, "spend.approve");
  const d = parse(input);
  return dup(() => prisma.$transaction(async (tx) => {
    const { q, job, contractor, org } = await loadForDecision(tx, ctx, quoteId);
    if (q.status !== "SUBMITTED") throw conflict("This quote is no longer open for a decision.");
    if (job.status === "AWAITING_APPROVAL" && job.recommendedQuoteId !== q.id) throw conflict("Another quote has been put forward for approval on this job.");
    if (job.status !== "QUOTING" && job.status !== "AWAITING_APPROVAL") throw conflict("This job is not waiting for a quote decision.");
    if (job.status === "QUOTING" && !ctx.roles.some((r) => r === "OWNER" || r === "MANAGER" || r === "APPROVER")) throw forbidden();
    const limit = approvalLimit(ctx, org);
    if (q.totalCents > limit)
      throw forbidden(`This quote (${formatZar(q.totalCents)}) is above your approval limit of ${formatZar(limit)}. Send it for approval instead.`);
    if (q.validUntil && new Date(new Date(q.validUntil).setHours(23, 59, 59, 999)) < new Date()) throw conflict("This quote has expired. Ask the contractor for an updated quote.");
    const exception = checkQuoteRule(org, q.totalCents, await quoteCount(tx, job.id), d.exceptionReason || job.quoteExceptionReason || "");
    if (org.poRequired && !d.poNumber) throw invalid("Enter the purchase order (PO) number.");
    const now = new Date();
    const r = await tx.quote.updateMany({ where: { id: q.id, status: "SUBMITTED" }, data: { status: "APPROVED", decidedAt: now } });
    if (r.count !== 1) throw conflict("This quote was just decided by someone else.");
    await tx.decision.create({
      data: { orgId: ctx.orgId, jobId: job.id, quoteId: q.id, outcome: "APPROVED", via: "PORTAL", deciderUserId: ctx.userId, deciderName: ctx.userName,
        deciderEmail: ctx.userEmail, comment: d.comment },
    });
    // Everyone else was not selected.
    const others = await tx.quote.findMany({ where: { jobId: job.id, status: "SUBMITTED", id: { not: q.id } }, include: { contractor: true } });
    await tx.quote.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "REJECTED", decidedAt: now } });
    await revokeJobLinks(tx, ctx.orgId, job.id, "QUOTE");
    const appointed = { contractorId: contractor.id, route: "CONTRACTOR" as const, approvedCostCents: q.totalCents, poNumber: d.poNumber || null, quoteExceptionReason: exception, recommendedQuoteId: null, ownerId: job.ownerId ?? ctx.userId };
    await move(tx, ctx.orgId, job, "APPROVED", appointed);
    await move(tx, ctx.orgId, { id: job.id, status: "APPROVED" }, "ASSIGNED", { assignedAt: now, leadTechnicianId: null });
    await logEvent(tx, actorOf(ctx), job.id, "quote.approved",
      `Quote ${q.number} v${q.version} from ${contractor.name} approved by ${ctx.userName} (${formatZar(q.totalCents)})${d.poNumber ? `, PO ${d.poNumber}` : ""}${exception ? ` – fewer quotes than required: ${exception}` : ""}`,
      { quoteId: q.id, totalCents: q.totalCents, poNumber: d.poNumber || null });
    await logEvent(tx, actorOf(ctx), job.id, "job.contractor_appointed", `${contractor.name} appointed`);
    await issueCompletionLink(tx, ctx, { ...job, ...appointed });
    for (const o of others)
      await queueEmail(tx, {
        orgId: ctx.orgId, to: o.contractor!.email, subject: `Quote ${o.number} for ${job.reference}: not selected`, dedupeKey: `quote-not-selected:${o.id}`,
        body: `Hello ${o.contractor!.contactName || o.contractor!.name},\n\nThank you for quoting on "${job.title}" (${job.reference}). On this occasion another quotation was accepted.`,
      });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "quote.approved", exceptUserId: ctx.userId, userIds: [...(await managerIds(tx, ctx.orgId)), job.requesterId],
      title: `${job.reference}: ${contractor.name} appointed`, body: job.title, eventKey: `quote-approved:${q.id}`,
    });
  }));
}

/** A manager puts a quote above their own limit forward for approval: QUOTING → AWAITING_APPROVAL. */
export async function recommendQuote(ctx: Ctx, quoteId: string, input: ApproveInput) {
  requirePerm(ctx, "quote.manage");
  const d = parse(input);
  return prisma.$transaction(async (tx) => {
    const { q, job, contractor, org } = await loadForDecision(tx, ctx, quoteId);
    if (q.status !== "SUBMITTED") throw conflict("This quote is no longer open for a decision.");
    if (job.status !== "QUOTING") throw conflict("This job is not collecting quotes.");
    const exception = checkQuoteRule(org, q.totalCents, await quoteCount(tx, job.id), d.exceptionReason);
    await move(tx, ctx.orgId, job, "AWAITING_APPROVAL", { recommendedQuoteId: q.id, quoteExceptionReason: exception });
    await logEvent(tx, actorOf(ctx), job.id, "quote.recommended",
      `Quote ${q.number} from ${contractor.name} (${formatZar(q.totalCents)}) sent for approval${d.comment ? `: ${d.comment}` : ""}`, { quoteId: q.id });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "quote.needs_approval", exceptUserId: ctx.userId,
      userIds: await approverIdsFor(tx, ctx.orgId, job.siteId, q.totalCents),
      title: `Approval needed: ${job.reference} – ${formatZar(q.totalCents)}`, body: `${contractor.name} for "${job.title}"${d.comment ? `\n"${d.comment}"` : ""}`, eventKey: `quote-recommended:${q.id}`,
    });
  });
}

/** An approver declines the recommended quote: AWAITING_APPROVAL → QUOTING (the manager can choose again). */
export async function rejectRecommendation(ctx: Ctx, jobId: string, input: { comment: string }) {
  requirePerm(ctx, "spend.approve");
  const comment = (input.comment ?? "").trim();
  if (comment.length < 3) throw invalid("Say why, so the maintenance team knows what to do next.");
  return dup(() => prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, ...jobScope(ctx) } });
    if (!job) throw notFound("Job not found.");
    if (job.status !== "AWAITING_APPROVAL" || !job.recommendedQuoteId) throw conflict("This job is not waiting for approval.");
    const { q, org, contractor } = await loadForDecision(tx, ctx, job.recommendedQuoteId);
    if (q.totalCents > approvalLimit(ctx, org)) throw forbidden("This quote is above your approval limit.");
    const r = await tx.quote.updateMany({ where: { id: q.id, status: "SUBMITTED" }, data: { status: "REJECTED", decidedAt: new Date() } });
    if (r.count !== 1) throw conflict("This quote was just decided by someone else.");
    await tx.decision.create({ data: { orgId: ctx.orgId, jobId: job.id, quoteId: q.id, outcome: "REJECTED", via: "PORTAL", deciderUserId: ctx.userId, deciderName: ctx.userName, deciderEmail: ctx.userEmail, comment } });
    await move(tx, ctx.orgId, job, "QUOTING", { recommendedQuoteId: null });
    await logEvent(tx, actorOf(ctx), job.id, "quote.rejected", `Quote ${q.number} from ${contractor.name} not approved by ${ctx.userName}: ${comment}`, { quoteId: q.id });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "quote.rejected", exceptUserId: ctx.userId, userIds: await managerIds(tx, ctx.orgId),
      title: `${job.reference}: quote not approved`, body: comment, eventKey: `quote-rejected:${q.id}`,
    });
  }));
}
