/**
 * The contractor portal behind /c/<token>. No account: the link is the credential, limited to ONE job and ONE
 * contractor, expiring and revocable. A contractor sees only what they need: the fault description, location,
 * the site's photos of the fault, their own quote, and (once appointed) the PO/approved value.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { hashToken } from "@/lib/tokens";
import { type Actor, logEvent } from "./activity";
import { addContractorFiles } from "./attachments";
import { assertToolsCheck, completionDetails, notifyCompletion, move } from "./jobs";
import { addSignature } from "./signatures";
import { insertContractorQuote, type QuoteFigures } from "./quotes";

const VISIBLE_KINDS = ["REQUEST", "ASSESSMENT"] as const;

async function loadLink(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return prisma.contractorLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { contractor: true, job: { include: { site: true, location: true, asset: true } } } });
}

export async function getContractorLinkView(token: string) {
  const link = await loadLink(token);
  // Quote links that were closed (award, withdrawal, newer link) still show a read-only status page to the contractor.
  if (!link || (link.revokedAt && link.purpose !== "QUOTE")) return null;
  const { job, contractor } = link;
  const [org, files, myQuotes, completion] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: link.orgId }, select: { name: true, brandColour: true, logoAttachmentId: true, phone: true, contactEmail: true, requireSignatures: true } }),
    prisma.attachment.findMany({ where: { orgId: link.orgId, jobId: job.id, kind: { in: [...VISIBLE_KINDS] } }, select: { id: true, filename: true, mimeType: true, kind: true }, orderBy: { createdAt: "asc" } }),
    prisma.quote.findMany({ where: { jobId: job.id, contractorId: contractor.id }, orderBy: { version: "desc" }, select: { id: true, number: true, version: true, status: true, subtotalCents: true, vatCents: true, totalCents: true, leadTimeDays: true, validUntil: true, scope: true, submittedAt: true } }),
    link.purpose === "COMPLETION" ? prisma.completion.findFirst({ where: { jobId: job.id, contractorId: contractor.id }, orderBy: { version: "desc" } }) : null,
  ]);
  const expired = link.expiresAt < new Date();
  let state: "open" | "expired" | "closed" | "submitted";
  if (link.purpose === "QUOTE") state = job.status !== "QUOTING" || link.revokedAt ? "closed" : expired ? "expired" : "open";
  else state = link.usedAt ? "submitted" : !["ASSIGNED", "IN_PROGRESS"].includes(job.status) || job.contractorId !== contractor.id ? "closed" : expired ? "expired" : "open";
  return {
    state, purpose: link.purpose, expiresAt: link.expiresAt, org,
    contractor: { name: contractor.name, vatRegistered: contractor.vatRegistered, contactName: contractor.contactName },
    job: {
      reference: job.reference, title: job.title, description: job.description, priority: job.priority, emergency: job.emergency,
      site: job.site.name, address: job.site.address, location: job.location?.name ?? null, foodArea: !!job.location?.foodArea, asset: job.asset ? `${job.asset.reference} – ${job.asset.name}` : null,
      scope: link.purpose === "QUOTE" ? link.scope : null,
      quoteDeadline: job.quoteDeadline, poNumber: link.purpose === "COMPLETION" ? job.poNumber : null,
      approvedCostCents: link.purpose === "COMPLETION" ? job.approvedCostCents : null,
    },
    files, myQuotes, completion: completion && { version: completion.version, status: completion.status, createdAt: completion.createdAt },
  };
}

const actorFor = (orgId: string, contractorName: string): Actor => ({ orgId, userId: null, label: `${contractorName} (contractor, via secure link)` });

/** Contractor submits or revises their quote. The link stays usable while the job is collecting quotes. */
export async function submitQuoteViaLink(token: string, input: QuoteFigures, files: { filename: string; bytes: Buffer }[]) {
  const link = await loadLink(token);
  if (!link || link.revokedAt || link.purpose !== "QUOTE") throw notFound("This link is not valid.");
  if (link.expiresAt < new Date()) throw conflict("The deadline for this quote has passed. Please contact the site.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUniqueOrThrow({ where: { id: link.jobId } });
    const actor = actorFor(link.orgId, link.contractor.name);
    const q = await insertContractorQuote(tx, actor, job, link.contractorId, input, true, link.createdById);
    await addContractorFiles(tx, { orgId: link.orgId, jobId: job.id, quoteId: q.id, kind: "QUOTE", files, actor });
    await tx.contractorLink.update({ where: { id: link.id }, data: { usedAt: link.usedAt ?? new Date() } });
    return { number: q.number, version: q.version, totalCents: q.totalCents };
  });
}

const completionSchema = z.object({
  workPerformed: z.string().trim().min(5, "Describe the work you did.").max(5000),
  observations: z.string().trim().max(5000).default(""),
  signerName: z.string().trim().max(120).default(""),
}).merge(completionDetails);

/** Appointed contractor submits completion with at least one photo. Single use per link. */
export async function submitCompletionViaLink(token: string, input: z.input<typeof completionSchema>, files: { filename: string; bytes: Buffer }[], signature?: string | null, ip?: string | null) {
  const p = completionSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  if (!files.length) throw invalid("Add at least one photo of the completed work.");
  const link = await loadLink(token);
  if (!link || link.revokedAt || link.purpose !== "COMPLETION") throw notFound("This link is not valid.");
  if (link.expiresAt < new Date()) throw conflict("This link has expired. Please contact the site for a new one.");
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.contractorLink.updateMany({ where: { id: link.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw conflict("Completion has already been submitted with this link.");
    const job = await tx.job.findUniqueOrThrow({ where: { id: link.jobId } });
    if (job.contractorId !== link.contractorId || !["ASSIGNED", "IN_PROGRESS"].includes(job.status)) throw conflict("This job is not waiting for your completion.");
    await assertToolsCheck(tx, link.orgId, job.locationId, p.data.toolsAndAreaOk);
    const actor = actorFor(link.orgId, link.contractor.name);
    const version = (await tx.completion.count({ where: { jobId: job.id } })) + 1;
    const now = new Date();
    const c = await tx.completion.create({
      data: { orgId: link.orgId, jobId: job.id, version, workPerformed: p.data.workPerformed, observations: p.data.observations, completedAt: now, submittedById: null, contractorId: link.contractorId,
        rootCauses: p.data.rootCauses, rootCauseNotes: p.data.rootCauseNotes, toolsAndAreaOk: p.data.toolsAndAreaOk },
    });
    const signer = p.data.signerName || link.contractor.contactName || link.contractor.name;
    await addSignature(tx, { orgId: link.orgId, jobId: job.id, step: "COMPLETED", name: `${signer} (${link.contractor.name})`, userId: null, dataUrl: signature, completionId: c.id, ip });
    await addContractorFiles(tx, { orgId: link.orgId, jobId: job.id, completionId: c.id, kind: "AFTER", files, actor });
    await move(tx, link.orgId, job, "AWAITING_VERIFICATION", { completedAt: now, startedAt: job.startedAt ?? now });
    await logEvent(tx, actor, job.id, "job.completion_submitted", `Completion submitted by ${link.contractor.name} (v${version}, ${files.length} photo${files.length === 1 ? "" : "s"})`, { completionId: c.id });
    await notifyCompletion(tx, link.orgId, job, c.id, null);
    return { version };
  });
}

/** Files a contractor may open through their link: the fault photos of that job, and their own uploads. */
export async function contractorLinkAllowsFile(token: string, attachmentId: string) {
  const link = await loadLink(token);
  if (!link || link.revokedAt || link.expiresAt < new Date()) return null;
  const att = await prisma.attachment.findFirst({ where: { id: attachmentId, orgId: link.orgId, jobId: link.jobId } });
  if (!att) return null;
  const ownQuote = att.quoteId ? await prisma.quote.count({ where: { id: att.quoteId, contractorId: link.contractorId } }) : 0;
  const ownCompletion = att.completionId ? await prisma.completion.count({ where: { id: att.completionId, contractorId: link.contractorId } }) : 0;
  return (VISIBLE_KINDS as readonly string[]).includes(att.kind) || ownQuote || ownCompletion ? att : null;
}
