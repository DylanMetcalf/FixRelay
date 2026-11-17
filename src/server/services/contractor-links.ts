/**
 * Secure links for external contractors (no account needed):
 *   QUOTE      – view the fault and submit/revise a quote until the job stops collecting quotes.
 *   COMPLETION – after appointment: submit what was done plus photo evidence (single use; re-issued for rework).
 * 256-bit token, only its SHA-256 stored, scoped to ONE job and ONE contractor, expiring, revocable.
 */
import type { LinkPurpose } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { formatZar } from "@/lib/money";
import { hashToken, newToken } from "@/lib/tokens";
import type { Ctx } from "../permissions";
import { logEvent, actorOf } from "./activity";
import { queueEmail } from "./notifications";

export const COMPLETION_LINK_DAYS = 90;
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));

export async function revokeJobLinks(tx: Tx, orgId: string, jobId: string, purpose?: LinkPurpose, contractorId?: string) {
  await tx.contractorLink.updateMany({
    where: { orgId, jobId, revokedAt: null, ...(purpose ? { purpose } : {}), ...(contractorId ? { contractorId } : {}) },
    data: { revokedAt: new Date() },
  });
}

async function issue(tx: Tx, ctx: Ctx, jobId: string, contractorId: string, purpose: LinkPurpose, expiresAt: Date) {
  await revokeJobLinks(tx, ctx.orgId, jobId, purpose, contractorId); // only the newest link of each kind works
  const token = newToken();
  const link = await tx.contractorLink.create({
    data: { orgId: ctx.orgId, jobId, contractorId, purpose, tokenHash: hashToken(token), createdById: ctx.userId, expiresAt },
  });
  return { link, token, url: `${appUrl()}/c/${token}` };
}

/** Invite one contractor to quote. Returns the one-time URL (also emailed). */
export async function issueQuoteLink(tx: Tx, ctx: Ctx, job: { id: string; reference: string; title: string; quoteDeadline: Date | null }, contractorId: string, scope: string) {
  const [c, org, site] = await Promise.all([
    tx.contractor.findFirstOrThrow({ where: { id: contractorId, orgId: ctx.orgId } }),
    tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    tx.job.findUniqueOrThrow({ where: { id: job.id }, select: { site: { select: { name: true, address: true } } } }),
  ]);
  const expires = job.quoteDeadline ? endOfDay(job.quoteDeadline) : new Date(Date.now() + 14 * 86_400_000);
  const r = await issue(tx, ctx, job.id, contractorId, "QUOTE", expires);
  await queueEmail(tx, {
    orgId: ctx.orgId, to: c.email, subject: `Request for quotation ${job.reference}: ${job.title}`, dedupeKey: `rfq:${r.link.id}`,
    body: `Hello ${c.contactName || c.name},\n\n${org.name} would like a quotation for:\n"${job.title}" at ${site.site.name}${site.site.address ? `, ${site.site.address}` : ""}.\n\n${scope}\n\nView the details and photos, and submit your quote here (no account needed):\n${r.url}\n\nPlease respond by ${expires.toDateString()}. This link is personal to your company.`,
  });
  await logEvent(tx, actorOf(ctx), job.id, "rfq.sent", `Quote requested from ${c.name}`, { contractorId, linkId: r.link.id });
  return r;
}

/** After appointment (or for rework): the contractor's link to submit completion evidence. */
export async function issueCompletionLink(tx: Tx, ctx: Ctx, job: { id: string; reference: string; title: string; contractorId: string | null; poNumber?: string | null; approvedCostCents?: number | null }, note?: string) {
  if (!job.contractorId) return null;
  const [c, org, full] = await Promise.all([
    tx.contractor.findFirstOrThrow({ where: { id: job.contractorId, orgId: ctx.orgId } }),
    tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    tx.job.findUniqueOrThrow({ where: { id: job.id }, select: { poNumber: true, approvedCostCents: true, site: { select: { name: true, address: true } } } }),
  ]);
  const r = await issue(tx, ctx, job.id, job.contractorId, "COMPLETION", new Date(Date.now() + COMPLETION_LINK_DAYS * 86_400_000));
  const po = full.poNumber ? `\nPurchase order: ${full.poNumber}` : "";
  const value = full.approvedCostCents != null ? `\nApproved value: ${formatZar(full.approvedCostCents)} incl. VAT` : "";
  await queueEmail(tx, {
    orgId: ctx.orgId, to: c.email, dedupeKey: `completion-link:${r.link.id}`,
    subject: note ? `Action needed on ${job.reference}: ${job.title}` : `You have been appointed: ${job.reference} ${job.title}`,
    body: `Hello ${c.contactName || c.name},\n\n${note ? `${note}\n\n` : `${org.name} has accepted your quotation and appointed you for "${job.title}" at ${full.site.name}${full.site.address ? `, ${full.site.address}` : ""}.${po}${value}\n\n`}When the work is finished, submit what you did and photos of the completed work here:\n${r.url}\n\nThe site will check the work before the job is closed.`,
  });
  await logEvent(tx, actorOf(ctx), job.id, "contractor.link_sent", note ? `Rework link sent to ${c.name}` : `Completion link sent to ${c.name}`, { linkId: r.link.id });
  return r;
}
