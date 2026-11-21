/**
 * Everything a job document needs, loaded through the same permission-checked `getJob` the job page uses, so a
 * PDF never shows more than the person could see on screen (prices, internal notes and photos are already removed
 * for people without access). Photos are read from private storage on the server and embedded; no public URLs.
 */
import QRCode from "qrcode";
import sharp from "sharp";
import { appUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { can, isStaff, type Ctx } from "../permissions";
import { getJob, type JobView } from "../services/jobs";
import { storage } from "../storage";

export interface Photo { id: string; data: Buffer; width: number; height: number; caption: string }

const KIND_CAPTION: Record<string, string> = { REQUEST: "Reported", BEFORE: "Before", AFTER: "After", ASSESSMENT: "Assessment", PROGRESS: "Progress" };

/** Decode, auto-rotate and downscale a stored image to a JPEG the PDF engine can embed (WebP is not supported there). */
async function toEmbeddable(bytes: Buffer, max = 1400): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    const { data, info } = await sharp(bytes).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null; // an unreadable file is listed in the record but not drawn
  }
}

async function loadPhotos(job: JobView, kinds: string[], limit: number): Promise<{ photos: Photo[]; more: number }> {
  const list = job.attachments.filter((a) => kinds.includes(a.kind) && a.mimeType.startsWith("image/"));
  const photos: Photo[] = [];
  for (const a of list.slice(0, limit)) {
    const raw = await storage().get(a.storageKey).catch(() => null);
    const img = raw ? await toEmbeddable(raw) : null;
    if (img) photos.push({ id: a.id, ...img, caption: `${KIND_CAPTION[a.kind] ?? a.kind} photo · ${a.createdAt.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" })}` });
  }
  return { photos, more: Math.max(0, list.length - limit) };
}

export async function loadJobDocument(ctx: Ctx, jobId: string) {
  const job = await getJob(ctx, jobId); // 404 if out of scope
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, address: true, phone: true } });
  const qr = await QRCode.toDataURL(`${appUrl() || "http://localhost:3000"}/jobs/${job.id}`, { margin: 0, width: 160, errorCorrectionLevel: "M", color: { dark: "#0B1F3A", light: "#FFFFFF" } });
  const signatures: { step: string; name: string; signedAt: Date; image: Buffer | null }[] = [];
  for (const sig of job.signatures) {
    const att = job.attachments.find((a) => a.id === sig.attachmentId);
    const raw = att ? await storage().get(att.storageKey).catch(() => null) : null;
    signatures.push({ step: sig.step, name: sig.name, signedAt: sig.signedAt, image: raw ? (await toEmbeddable(raw, 600))?.data ?? null : null });
  }
  const name = (id: string | null | undefined) => (id ? (job.people[id] ?? "Unknown") : "");
  const departments = job.handovers.length
    ? Object.fromEntries((await prisma.department.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } })).map((d) => [d.id, d.name]))
    : {};
  return {
    job, org, qr, signatures, name, departments,
    staff: isStaff(ctx), seePrices: can(ctx, "quote.view"),
    loadPhotos: (kinds: string[], limit: number) => loadPhotos(job, kinds, limit),
    generatedAt: new Date(),
  };
}
export type JobDocumentData = Awaited<ReturnType<typeof loadJobDocument>>;
