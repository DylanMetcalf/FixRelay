/**
 * File attachments. Safety rules:
 *  - type is decided by sniffing the file's leading bytes, never by the client's filename or MIME claim;
 *  - only JPEG, PNG, WebP and PDF are accepted, max 10 MB each, max 100 per job;
 *  - storage keys are random; files are private and only returned after a permission check.
 */
import { randomUUID } from "node:crypto";
import type { AttachmentKind } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { hashToken } from "@/lib/tokens";
import { can, isManager, isStaff, jobScope, requirePerm, type Ctx } from "../permissions";
import { storage } from "../storage";
import { actorOf, logEvent } from "./activity";
import { isAssigned } from "./jobs";

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PER_JOB = 100;
const CUSTOMER_VISIBLE: AttachmentKind[] = ["REQUEST", "QUOTE", "BEFORE", "AFTER", "TEST_DOCUMENT", "SIGNATURE"];

export function sniffMime(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

const cleanName = (n: string) => (n.split(/[\\/]/).pop() ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

async function store(tx: Tx, a: { orgId: string; jobId: string | null; quoteId?: string | null; completionId?: string | null; kind: AttachmentKind; filename: string; bytes: Buffer; uploadedById: string | null; imagesOnly?: boolean }) {
  if (a.bytes.length === 0) throw invalid("The file is empty.");
  if (a.bytes.length > MAX_BYTES) throw invalid("Files must be 10 MB or smaller.");
  const mimeType = sniffMime(a.bytes);
  if (!mimeType || (a.imagesOnly && mimeType === "application/pdf"))
    throw invalid(a.imagesOnly ? "Only JPEG, PNG or WebP images are allowed." : "Only JPEG, PNG, WebP images and PDF documents are allowed.");
  const storageKey = `${a.orgId}/${randomUUID()}`;
  await storage().put(storageKey, a.bytes);
  return tx.attachment.create({
    data: { orgId: a.orgId, jobId: a.jobId, quoteId: a.quoteId ?? null, completionId: a.completionId ?? null, kind: a.kind,
      storageKey, filename: cleanName(a.filename), mimeType, sizeBytes: a.bytes.length, uploadedById: a.uploadedById },
  });
}

export interface UploadInput { jobId: string; kind: AttachmentKind; filename: string; bytes: Buffer; quoteId?: string }

export async function addJobAttachment(ctx: Ctx, input: UploadInput) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: input.jobId, ...jobScope(ctx) }, include: { technicians: true } });
    if (!job) throw notFound("Job not found.");
    if (job.status === "CLOSED" || job.status === "CANCELLED") throw conflict("This job is closed. Reopen it to add files.");
    let quoteId: string | null = null;
    switch (input.kind) {
      case "REQUEST": // the reporter (or a manager) adds supporting evidence to the request
        requirePerm(ctx, "job.create");
        if (job.requesterId !== ctx.userId && !isManager(ctx)) throw forbidden();
        break;
      case "ASSESSMENT": case "PROGRESS": case "BEFORE": case "AFTER": case "TEST_DOCUMENT":
        requirePerm(ctx, "job.work");
        if (!isManager(ctx) && !isAssigned(job, ctx.userId)) throw forbidden("You are not assigned to this job.");
        break;
      case "QUOTE": {
        requirePerm(ctx, "quote.manage");
        const q = await tx.quote.findFirst({ where: { id: input.quoteId ?? "", orgId: ctx.orgId, jobId: job.id, status: "DRAFT" } });
        if (!q) throw conflict("Files can only be added to a draft quote.");
        quoteId = q.id;
        break;
      }
      default:
        throw invalid("Unsupported attachment type.");
    }
    if ((await tx.attachment.count({ where: { jobId: job.id } })) >= MAX_PER_JOB) throw conflict("This job has reached the attachment limit.");
    const att = await store(tx, { orgId: ctx.orgId, jobId: job.id, quoteId, kind: input.kind, filename: input.filename, bytes: input.bytes, uploadedById: ctx.userId });
    await logEvent(tx, actorOf(ctx), job.id, "attachment.added", `File added: ${att.filename} (${input.kind.toLowerCase().replace("_", " ")})`, { attachmentId: att.id });
    return att;
  });
}

export async function setOrgLogo(ctx: Ctx, input: { filename: string; bytes: Buffer }) {
  requirePerm(ctx, "org.manage");
  if (input.bytes.length > 1024 * 1024) throw invalid("Logos must be 1 MB or smaller.");
  return prisma.$transaction(async (tx) => {
    const att = await store(tx, { orgId: ctx.orgId, jobId: null, kind: "LOGO", filename: input.filename, bytes: input.bytes, uploadedById: ctx.userId, imagesOnly: true });
    await tx.organisation.update({ where: { id: ctx.orgId }, data: { logoAttachmentId: att.id } });
    return att;
  });
}

/** Stores a drawn signature (PNG data URL from the sign-off pad). Used inside decision transactions. */
export async function storeSignature(tx: Tx, a: { orgId: string; jobId: string; completionId: string; dataUrl: string }) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(a.dataUrl);
  if (!m) throw invalid("The signature could not be read. Please sign again.");
  const bytes = Buffer.from(m[1]!, "base64");
  if (bytes.length > 300 * 1024 || sniffMime(bytes) !== "image/png") throw invalid("The signature could not be read. Please sign again.");
  return store(tx, { orgId: a.orgId, jobId: a.jobId, completionId: a.completionId, kind: "SIGNATURE", filename: "signature.png", bytes, uploadedById: null });
}

const read = async (att: { storageKey: string; mimeType: string; filename: string }) =>
  ({ bytes: await storage().get(att.storageKey), mimeType: att.mimeType, filename: att.filename });

/** Authorised download for a signed-in member. Tenant, job scope and customer-visibility are all checked. */
export async function readAttachment(ctx: Ctx, id: string) {
  const att = await prisma.attachment.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!att) throw notFound();
  if (att.kind === "LOGO") return read(att);
  if (!att.jobId || !(await prisma.job.findFirst({ where: { id: att.jobId, ...jobScope(ctx) }, select: { id: true } }))) throw notFound();
  if (!isStaff(ctx) && !CUSTOMER_VISIBLE.includes(att.kind)) throw notFound();
  if (att.kind === "QUOTE" && !can(ctx, "quote.view")) throw notFound();
  return read(att);
}

/** Download through a customer review link: only the tenant logo and files bound to that link's quote / completion. */
export async function readAttachmentViaLink(token: string, id: string) {
  const link = await prisma.approvalLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.revokedAt || link.expiresAt < new Date()) throw notFound();
  const att = await prisma.attachment.findFirst({ where: { id, orgId: link.orgId } });
  if (!att) throw notFound();
  const ok =
    (att.kind === "LOGO" && (await prisma.organisation.count({ where: { id: link.orgId, logoAttachmentId: att.id } })) === 1) ||
    (link.quoteId !== null && att.quoteId === link.quoteId) ||
    (link.completionId !== null && att.completionId === link.completionId);
  if (!ok) throw notFound();
  return read(att);
}
