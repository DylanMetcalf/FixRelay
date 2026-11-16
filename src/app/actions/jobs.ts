"use server";
import type { AttachmentKind } from "@prisma/client";
import { invalid } from "@/lib/errors";
import { parseRandToCents } from "@/lib/money";
import { rateLimit } from "@/lib/rate-limit";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import * as quotes from "@/server/services/quotes";
import { type ActionState, bool, filesOf, list, run, str } from "../_lib/action";
import { clientIp, requireCtx } from "../_lib/session";

const id = (fd: FormData) => str(fd, "jobId");

async function attach(ctx: Awaited<ReturnType<typeof requireCtx>>, fd: FormData, jobId: string, kind: AttachmentKind, field = "files") {
  for (const f of await filesOf(fd, field)) await addJobAttachment(ctx, { jobId, kind, ...f });
}

export async function createJobAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    const job = await jobs.createJob(ctx, {
      title: str(fd, "title"), description: str(fd, "description"), clientId: str(fd, "clientId"), siteId: str(fd, "siteId"),
      locationId: str(fd, "locationId"), assetId: str(fd, "assetId"), category: str(fd, "category") as "General",
      priority: str(fd, "priority") as "NORMAL", emergency: bool(fd, "emergency"),
    });
    await attach(ctx, fd, job.id, "REQUEST");
    return { redirect: `/jobs/${job.id}` };
  });
}

export async function priorityAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.changePriority(await requireCtx(), id(fd), str(fd, "priority")); return { ok: "Priority updated." }; });
}
export async function signoffRuleAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.setSignoffRequired(await requireCtx(), id(fd), str(fd, "required") === "true"); return { ok: "Updated." }; });
}
export async function requestAssessmentAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.requestAssessment(await requireCtx(), id(fd), { assessorId: str(fd, "assessorId") }); return { ok: "Sent for assessment." }; });
}

export async function assessmentAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    await jobs.submitAssessment(ctx, id(fd), {
      findings: str(fd, "findings"), suspectedCause: str(fd, "suspectedCause"), recommendedWork: str(fd, "recommendedWork"), materials: str(fd, "materials"),
      labourHoursEstimate: str(fd, "labourHoursEstimate"), quoteRequired: str(fd, "quoteRequired") === "yes", externalHelpRequired: bool(fd, "externalHelpRequired"),
    });
    await attach(ctx, fd, id(fd), "ASSESSMENT");
    return { ok: "Assessment recorded." };
  });
}

export async function authoriseAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.authoriseWithoutQuote(await requireCtx(), id(fd), { reason: str(fd, "reason") }); return { ok: "Work authorised." }; });
}

export async function assignAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await jobs.assignJob(await requireCtx(), id(fd), {
      leadTechnicianId: str(fd, "leadTechnicianId"), additionalIds: list(fd, "additionalIds"), externalContractor: str(fd, "externalContractor"),
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
    const kind = str(fd, "kind") as AttachmentKind;
    if (!(await filesOf(fd, "files")).length) throw invalid("Choose at least one file.");
    await attach(ctx, fd, id(fd), kind);
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
    await jobs.submitCompletion(ctx, id(fd), { workPerformed: str(fd, "workPerformed"), observations: str(fd, "observations"), completedAt: str(fd, "completedAt") });
    return { ok: "Submitted for verification." };
  });
}

export async function closeAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.closeJob(await requireCtx(), id(fd), { comment: str(fd, "comment") }); return { ok: "Job closed." }; });
}
export async function reopenAction(_: ActionState, fd: FormData) {
  return run(async () => { await jobs.reopenJob(await requireCtx(), id(fd), { reason: str(fd, "reason") }); return { ok: "Job reopened." }; });
}

// ----- Quotes -----

export async function createQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const q = await quotes.createQuote(await requireCtx(), id(fd), str(fd, "kind") === "VARIATION" ? "VARIATION" : "ORIGINAL");
    return { redirect: `/quotes/${q.id}` };
  });
}

export async function saveQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    const quoteId = str(fd, "quoteId");
    let raw: { kind: "LABOUR" | "MATERIAL" | "OTHER"; description: string; quantity: string; unitPrice: string; taxable: boolean }[];
    try { raw = JSON.parse(str(fd, "lines")); } catch { throw invalid("Could not read the line items."); }
    await quotes.saveQuote(ctx, quoteId, {
      scope: str(fd, "scope"), terms: str(fd, "terms"), validUntil: str(fd, "validUntil"),
      lines: raw.filter((l) => l.description.trim() || l.unitPrice.trim()).map((l) => ({
        kind: l.kind, description: l.description, quantity: l.quantity, unitPriceCents: parseRandToCents(l.unitPrice || "0"), taxable: !!l.taxable,
      })),
    });
    for (const f of await filesOf(fd, "files")) await addJobAttachment(ctx, { jobId: str(fd, "jobId"), kind: "QUOTE", quoteId, ...f });
    if (str(fd, "intent") === "submit") { await quotes.submitQuote(ctx, quoteId); return { ok: "Quote submitted for approval." }; }
    return { ok: "Draft saved." };
  });
}

export async function reviseQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => { const q = await quotes.reviseQuote(await requireCtx(), str(fd, "quoteId")); return { redirect: `/quotes/${q.id}` }; });
}

export async function sendLinkAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const target = str(fd, "quoteId") ? { quoteId: str(fd, "quoteId") } : { completionId: str(fd, "completionId") };
    const l = await approvals.createApprovalLink(await requireCtx(), target, { recipientName: str(fd, "recipientName"), recipientEmail: str(fd, "recipientEmail") });
    return { ok: "Secure link created and emailed.", data: { link: l.url } };
  });
}

export async function recordQuoteDecisionAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await approvals.recordQuoteDecision(await requireCtx(), str(fd, "quoteId"), { outcome: str(fd, "outcome") as "APPROVED", name: str(fd, "name"), comment: str(fd, "comment") });
    return { ok: "Decision recorded." };
  });
}

export async function portalQuoteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await approvals.portalDecideQuote(await requireCtx(), str(fd, "quoteId"), { outcome: str(fd, "outcome") as "APPROVED", comment: str(fd, "comment") }, await clientIp());
    return { ok: "Thank you. Your decision has been recorded." };
  });
}

export async function portalCompletionAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await approvals.portalDecideCompletion(await requireCtx(), str(fd, "completionId"),
      { outcome: str(fd, "outcome") as "APPROVED", comment: str(fd, "comment"), signature: str(fd, "signature") || undefined }, await clientIp());
    return { ok: "Thank you. Your decision has been recorded." };
  });
}

export async function captureSignoffAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await approvals.captureSignoff(await requireCtx(), str(fd, "completionId"),
      { outcome: str(fd, "outcome") as "APPROVED", name: str(fd, "name"), comment: str(fd, "comment"), signature: str(fd, "signature") || undefined });
    return { ok: "Customer sign-off recorded." };
  });
}

/** Public: decision through a secure review link. No session; the token is the credential. Rate limited. */
export async function publicDecideAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    rateLimit(`link:ip:${ip}`, 30, 10 * 60_000);
    await approvals.decideViaLink(str(fd, "token"),
      { outcome: str(fd, "outcome") as "APPROVED", name: str(fd, "name"), comment: str(fd, "comment"), signature: str(fd, "signature") || undefined }, ip);
    return { ok: "Thank you. Your decision has been recorded." };
  });
}
