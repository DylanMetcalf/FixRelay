"use server";
import type { AttachmentKind } from "@prisma/client";
import { invalid } from "@/lib/errors";
import { parseRandToCents } from "@/lib/money";
import { rateLimit } from "@/lib/rate-limit";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import * as portal from "@/server/services/portal";
import * as quotes from "@/server/services/quotes";
import { type ActionState, bool, filesOf, list, run, str } from "../_lib/action";
import { clientIp, requireCtx } from "../_lib/session";

const id = (fd: FormData) => str(fd, "jobId");
const optDate = (v: string) => (v ? new Date(v) : null);
const optInt = (v: string) => (v.trim() ? Number.parseInt(v, 10) : null);
/** Drawn signature (PNG data URL) from the signature pad, if any. */
const sig = (fd: FormData) => str(fd, "signature") || null;
/** Requisition completion details: root cause boxes, notes, and the food-area tools/clean check (Y/N). */
const completionDetails = (fd: FormData) => ({
  rootCauses: list(fd, "rootCauses") as ("OTHER")[], rootCauseNotes: str(fd, "rootCauseNotes"),
  toolsAndAreaOk: str(fd, "toolsAndAreaOk") === "yes" ? true : str(fd, "toolsAndAreaOk") === "no" ? false : null,
});

async function attach(ctx: Awaited<ReturnType<typeof requireCtx>>, fd: FormData, jobId: string, kind: AttachmentKind, field = "files", quoteId?: string) {
  for (const f of await filesOf(fd, field)) await addJobAttachment(ctx, { jobId, kind, quoteId, ...f });
}

export async function createJobAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    const job = await jobs.createJob(ctx, {
      title: str(fd, "title"), description: str(fd, "description"), siteId: str(fd, "siteId"),
      locationId: str(fd, "locationId"), assetId: str(fd, "assetId"), category: (str(fd, "category") || "General") as "General",
      priority: str(fd, "priority") as "NORMAL", emergency: bool(fd, "emergency"), isProject: bool(fd, "isProject"),
    }, sig(fd));
    await attach(ctx, fd, job.id, "REQUEST");
    return { redirect: `/jobs/${job.id}` };
  });
}

/** Public: report a fault from a site link / QR code without an account. Rate limited per IP and per site. */
export async function publicReportAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    const token = str(fd, "siteToken");
    await rateLimit(`public-report:ip:${ip}`, 10, 60 * 60_000);
    await rateLimit(`public-report:site:${token}`, 200, 24 * 60 * 60_000);
    // The simple QR form asks "what kind of problem?" (optional tap) and a description; the title is made from them.
    const kind = str(fd, "kind").trim().slice(0, 40);
    const description = str(fd, "description").trim();
    const title = str(fd, "title").trim() || [kind, description.split(/\s+/).slice(0, 10).join(" ")].filter(Boolean).join(": ").slice(0, 160);
    const r = await jobs.createPublicReport(token, {
      title, description, locationId: str(fd, "locationId"), assetId: str(fd, "assetId"), priority: (str(fd, "priority") || "NORMAL") as "NORMAL",
      reporterName: str(fd, "reporterName"), reporterPhone: str(fd, "reporterPhone"), reporterEmail: str(fd, "reporterEmail"),
    }, sig(fd), ip, await filesOf(fd, "photos"));
    return { ok: `Thank you. Your report ${r.reference} has been sent to the maintenance team.`, data: { sent: "1", reference: r.reference } };
  });
}

export async function priorityAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.changePriority(await requireCtx(), id(fd), str(fd, "priority")); return { ok: "Priority updated." }; });
}
export async function signoffRuleAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.setSignoffRequired(await requireCtx(), id(fd), str(fd, "required") === "true"); return { ok: "Updated." }; });
}
export async function requestAssessmentAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.requestAssessment(await requireCtx(), id(fd), { assessorId: str(fd, "assessorId") }, sig(fd)); return { ok: "Sent for assessment." }; });
}

export async function assessmentAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    await jobs.submitAssessment(ctx, id(fd), {
      findings: str(fd, "findings"), suspectedCause: str(fd, "suspectedCause"), recommendedWork: str(fd, "recommendedWork"), materials: str(fd, "materials"),
      labourHoursEstimate: str(fd, "labourHoursEstimate"), quoteRequired: str(fd, "quoteRequired") === "yes", externalHelpRequired: bool(fd, "externalHelpRequired"),
      sparesNeeded: (str(fd, "sparesNeeded") || "NOT_NEEDED") as "NOT_NEEDED", sparesList: str(fd, "sparesList"),
    }, sig(fd));
    await attach(ctx, fd, id(fd), "ASSESSMENT");
    return { ok: "Assessment recorded." };
  });
}

export async function inHouseAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.routeInHouse(await requireCtx(), id(fd), { note: str(fd, "note") }); return { ok: "The in-house team will fix this. Now assign a technician." }; });
}

export async function assignAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await jobs.assignJob(await requireCtx(), id(fd), {
      leadTechnicianId: str(fd, "leadTechnicianId"), additionalIds: list(fd, "additionalIds"),
      plannedStart: str(fd, "plannedStart"), plannedEnd: str(fd, "plannedEnd"), instructions: str(fd, "instructions"),
    });
    return { ok: "Assignment saved." };
  });
}

export async function startAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.startWork(await requireCtx(), id(fd)); return { ok: "Work started." }; });
}

export async function workUpdateAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    const cost = str(fd, "materialCost").trim();
    await jobs.addWorkUpdate(ctx, id(fd), {
      kind: str(fd, "kind") as "PROGRESS", note: str(fd, "note"), labourMinutes: (str(fd, "labourMinutes") || "0") as unknown as number,
      materialDescription: str(fd, "materialDescription"), materialCostCents: cost ? parseRandToCents(cost) : 0,
    });
    await attach(ctx, fd, id(fd), "PROGRESS");
    return { ok: "Update added." };
  });
}

export async function evidenceAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    if (!(await filesOf(fd, "files")).length) throw invalid("Choose at least one file.");
    await attach(ctx, fd, id(fd), str(fd, "kind") as AttachmentKind);
    return { ok: "Uploaded." };
  });
}

export async function holdAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.holdJob(await requireCtx(), id(fd), { reason: str(fd, "reason") }); return { ok: "Job put on hold." }; });
}
export async function resumeAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.resumeJob(await requireCtx(), id(fd)); return { ok: "Work resumed." }; });
}
export async function cancelAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.cancelJob(await requireCtx(), id(fd), { reason: str(fd, "reason") }); return { ok: "Job cancelled." }; });
}

export async function completionAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    await attach(ctx, fd, id(fd), "BEFORE", "before");
    await attach(ctx, fd, id(fd), "AFTER", "after");
    await attach(ctx, fd, id(fd), "TEST_DOCUMENT", "tests");
    await jobs.submitCompletion(ctx, id(fd), { workPerformed: str(fd, "workPerformed"), observations: str(fd, "observations"), completedAt: str(fd, "completedAt"), ...completionDetails(fd) }, sig(fd));
    return { ok: "Submitted for confirmation." };
  });
}

/** Reporter (or a manager with a reason) confirms whether the fault is fixed. */
export async function confirmFixedAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ok = str(fd, "outcome") === "APPROVED";
    await jobs.confirmFixed(await requireCtx(), id(fd), { outcome: ok ? "APPROVED" : "REJECTED", comment: str(fd, "comment") }, { reporterSignature: sig(fd) });
    return { ok: ok ? "Thank you – confirmed fixed." : "Thank you – it has been sent back to be fixed." };
  });
}

/** The reporter signs on a technician's device (e.g. they have no account). */
export async function captureSignoffAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ok = str(fd, "outcome") === "APPROVED";
    const name = str(fd, "name").trim();
    if (name.length < 2) throw invalid("Enter the full name of the person signing.");
    if (!str(fd, "signature")) throw invalid("A signature is required.");
    await jobs.confirmFixed(await requireCtx(), id(fd), { outcome: ok ? "APPROVED" : "REJECTED", comment: str(fd, "comment") }, { signature: { name, dataUrl: str(fd, "signature") } });
    return { ok: "Sign-off recorded." };
  });
}

export async function resendCompletionLinkAction(_: ActionState, fd: FormData) {
  return run(async () => { const url = await jobs.resendCompletionLink(await requireCtx(), id(fd)); return { ok: "A new link was emailed to the contractor.", data: { link: url } }; });
}

export async function closeAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.closeJob(await requireCtx(), id(fd), { comment: str(fd, "comment") }, sig(fd)); return { ok: "Signed off and closed." }; });
}
export async function sparesAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const action = str(fd, "sparesAction") as "ISSUED";
    await jobs.updateSpares(await requireCtx(), id(fd), { action, note: str(fd, "note"), eta: str(fd, "eta") });
    return { ok: { ISSUED: "Marked as issued.", ORDERED: "Marked as ordered.", RECEIVED: "Marked as received." }[action] ?? "Updated." };
  });
}

export async function requestSparesAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await jobs.requestSpares(await requireCtx(), id(fd), { sparesNeeded: str(fd, "sparesNeeded") as "ON_HAND", sparesList: str(fd, "sparesList") });
    return { ok: "Stores and the maintenance manager have been told." };
  });
}

export async function reopenAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.reopenJob(await requireCtx(), id(fd), { reason: str(fd, "reason") }); return { ok: "Job reopened." }; });
}

// ----- Contractor quotes and approvals -----

export async function requestQuotesAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const links = await quotes.requestQuotes(await requireCtx(), id(fd), { contractorIds: list(fd, "contractorIds"), scope: str(fd, "scope"), deadline: optDate(str(fd, "deadline")) });
    return { ok: `Quote requests sent to ${links.map((l) => l.contractorName).join(", ")}.`, data: { link: links[0]!.url, links: JSON.stringify(links) } };
  });
}

export async function recordQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    const q = await quotes.recordQuote(ctx, id(fd), str(fd, "contractorId"), {
      scope: str(fd, "scope"), priceExclVatCents: parseRandToCents(str(fd, "price") || "0"),
      leadTimeDays: optInt(str(fd, "leadTimeDays")), validUntil: optDate(str(fd, "validUntil")),
    });
    await attach(ctx, fd, id(fd), "QUOTE", "files", q.id);
    return { ok: "Quote captured." };
  });
}

export async function withdrawInviteAction(_: ActionState, fd: FormData) {
  return run(async () => { await quotes.withdrawInvite(await requireCtx(), id(fd), str(fd, "contractorId")); return { ok: "Stopped waiting for that contractor." }; });
}

const approveInput = (fd: FormData) => ({ poNumber: str(fd, "poNumber"), exceptionReason: str(fd, "exceptionReason"), comment: str(fd, "comment") });

export async function approveQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => { await approvals.approveQuote(await requireCtx(), str(fd, "quoteId"), approveInput(fd), sig(fd)); return { ok: "Quote approved and contractor appointed." }; });
}
export async function recommendQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => { await approvals.recommendQuote(await requireCtx(), str(fd, "quoteId"), approveInput(fd)); return { ok: "Sent for approval." }; });
}
export async function rejectRecommendationAction(_: ActionState, fd: FormData) {
  return run(async () => { await approvals.rejectRecommendation(await requireCtx(), id(fd), { comment: str(fd, "comment") }); return { ok: "Not approved – sent back to the maintenance team." }; });
}

// ----- Contractor portal (public; the link token is the credential) -----

export async function contractorQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await rateLimit(`contractor:ip:${await clientIp()}`, 40, 60 * 60_000);
    const r = await portal.submitQuoteViaLink(str(fd, "token"), {
      scope: str(fd, "scope"), priceExclVatCents: parseRandToCents(str(fd, "price") || "0"),
      leadTimeDays: optInt(str(fd, "leadTimeDays")), validUntil: optDate(str(fd, "validUntil")),
    }, await filesOf(fd, "files"));
    return { ok: `Thank you. Quote ${r.number}${r.version > 1 ? ` (version ${r.version})` : ""} has been submitted.` };
  });
}

export async function contractorCompletionAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    await rateLimit(`contractor:ip:${ip}`, 40, 60 * 60_000);
    await portal.submitCompletionViaLink(str(fd, "token"), { workPerformed: str(fd, "workPerformed"), observations: str(fd, "observations"), signerName: str(fd, "signerName"), ...completionDetails(fd) }, await filesOf(fd, "files"), sig(fd), ip);
    return { ok: "Thank you. Your completion has been submitted. The site will check the work." };
  });
}
