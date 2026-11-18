/**
 * Signatures on the maintenance work requisition. Each signature line of the paper form maps to a step:
 *   REPORTED   "Submitted by"            – whoever reports the fault (app or QR link)
 *   RECEIVED   "Submitted to"            – the maintenance person who accepts it
 *   APPROVAL   quote / spend sign-off    – the manager or approver who approves the spend
 *   COMPLETED  "Date completed … By"     – the technician or contractor who did the work
 *   ORIGINATOR "Confirmed by originator" – the person who reported it confirms it is resolved
 *   MANAGER    "Confirmed by manager"    – the manager signs it off and closes it
 * Date and time are always set by the server (never typed). Rows are append-only (DB trigger). When the company
 * switches "require signatures" on, the step refuses to continue without one; otherwise signing is optional.
 */
import type { SignatureStep } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { invalid } from "@/lib/errors";
import { storeSignature } from "./attachments";

export const SIGNATURE_LINE: Record<SignatureStep, string> = {
  REPORTED: "Submitted by",
  RECEIVED: "Submitted to (received by maintenance)",
  APPROVAL: "Quote / spend signed off",
  COMPLETED: "Work completed by",
  ORIGINATOR: "Confirmed by originator",
  MANAGER: "Confirmed by manager",
};

const ASK: Record<SignatureStep, string> = {
  REPORTED: "Please sign the report (Submitted by).",
  RECEIVED: "Please sign to show maintenance has received this report.",
  APPROVAL: "Please sign to approve this quote.",
  COMPLETED: "Please sign to confirm the work is complete.",
  ORIGINATOR: "Please sign to confirm the problem has been resolved.",
  MANAGER: "Please sign to confirm and close this job.",
};

export async function signaturesRequired(tx: Tx, orgId: string) {
  return (await tx.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { requireSignatures: true } })).requireSignatures;
}

/**
 * Record a signature for one line of the requisition. Returns null when none was drawn and none is required.
 * `dataUrl` is the PNG from the signature pad.
 */
export async function addSignature(tx: Tx, a: {
  orgId: string; jobId: string; step: SignatureStep; name: string; userId: string | null; dataUrl?: string | null;
  quoteId?: string | null; completionId?: string | null; ip?: string | null; required?: boolean;
}) {
  const required = a.required ?? (await signaturesRequired(tx, a.orgId));
  if (!a.dataUrl) {
    if (required) throw invalid(ASK[a.step]);
    return null;
  }
  const name = a.name.trim();
  if (name.length < 2) throw invalid("Enter the name of the person signing.");
  const file = await storeSignature(tx, { orgId: a.orgId, jobId: a.jobId, completionId: a.completionId ?? null, dataUrl: a.dataUrl });
  return tx.jobSignature.create({
    data: { orgId: a.orgId, jobId: a.jobId, step: a.step, name: name.slice(0, 120), userId: a.userId, attachmentId: file.id,
      quoteId: a.quoteId ?? null, completionId: a.completionId ?? null, ip: a.ip ?? null },
  });
}
