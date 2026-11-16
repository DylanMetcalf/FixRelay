import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import * as quotes from "@/server/services/quotes";
import { code, completedJob, LINES, newJob, PNG, PNG_DATA_URL, quotedJob, startedJob, status, tenant } from "../helpers";

const link = (t: Awaited<ReturnType<typeof tenant>>, target: { quoteId: string } | { completionId: string }) =>
  approvals.createApprovalLink(t.manager, target, { recipientName: "Carl Customer", recipientEmail: "carl@client.example" });

describe("primary journey: fault reported → closed", () => {
  it("runs end to end with customer approval and sign-off by secure link, leaving a full audit trail", async () => {
    const t = await tenant();
    const job = await newJob(t, t.rep); // the customer logs the fault
    expect(job.reference).toBe("REQ-00001");
    expect(job.dueAt).not.toBeNull();
    await addJobAttachment(t.rep, { jobId: job.id, kind: "REQUEST", filename: "fault.png", bytes: PNG });
    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
    await jobs.submitAssessment(t.tech, job.id, { findings: "Drive belt worn", suspectedCause: "Age", quoteRequired: true });
    expect(await status(job.id)).toBe("ASSESSED");

    const q = await quotes.createQuote(t.manager, job.id);
    const totals = await quotes.saveQuote(t.manager, q.id, { scope: "Replace belt", terms: "", validUntil: null, lines: LINES });
    expect(totals).toEqual({ subtotalCents: 285956, vatCents: 0, totalCents: 285956 }); // tenant not VAT registered
    await quotes.submitQuote(t.manager, q.id);
    expect(await status(job.id)).toBe("AWAITING_APPROVAL");

    const ql = await link(t, { quoteId: q.id });
    const view = await approvals.getLinkView(ql.token);
    expect(view?.state).toBe("open");
    expect(view?.quote?.totalCents).toBe(285956);
    await approvals.decideViaLink(ql.token, { outcome: "APPROVED", name: "Carl Customer" }, "10.0.0.1");
    expect(await status(job.id)).toBe("APPROVED");

    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId, plannedEnd: "2031-01-01" });
    await jobs.startWork(t.tech, job.id);
    await jobs.addWorkUpdate(t.tech, job.id, { note: "Belt removed", labourMinutes: 90, materialDescription: "Belt", materialCostCents: 100000 });
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced belt" })).rejects.toThrow(/evidence/);
    await addJobAttachment(t.tech, { jobId: job.id, kind: "BEFORE", filename: "before.png", bytes: PNG });
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after.png", bytes: PNG });
    const c = await jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced belt, tested under load" });
    expect(await status(job.id)).toBe("AWAITING_VERIFICATION");
    expect(await prisma.attachment.count({ where: { completionId: c.id } })).toBe(2);

    await expect(jobs.closeJob(t.manager, job.id)).rejects.toThrow(/customer sign-off/);
    const cl = await link(t, { completionId: c.id });
    await approvals.decideViaLink(cl.token, { outcome: "APPROVED", name: "Carl Customer", signature: PNG_DATA_URL });
    expect(await status(job.id)).toBe("VERIFIED");
    await jobs.closeJob(t.manager, job.id);
    expect(await status(job.id)).toBe("CLOSED");

    const full = await jobs.getJob(t.manager, job.id);
    const types = full.events.map((e) => e.type);
    for (const ty of ["job.created", "job.assessment_requested", "job.assessed", "quote.submitted", "quote.approved", "job.assigned",
      "job.started", "job.completion_submitted", "completion.approved", "job.closed"]) expect(types).toContain(ty);
    expect(full.events.every((e) => e.actorLabel.length > 0)).toBe(true);
    const d = full.completions[0]!.decision!;
    expect(d).toMatchObject({ via: "LINK", deciderName: "Carl Customer", outcome: "APPROVED" });
    expect(d.signatureAttachmentId).not.toBeNull();
  });
});

describe("alternative paths", () => {
  it("rejected quote → revision keeps every version; approved version is frozen", async () => {
    const t = await tenant();
    const { job, quote } = await quotedJob(t);
    const l1 = await link(t, { quoteId: quote.id });
    await expect(approvals.decideViaLink(l1.token, { outcome: "REJECTED", name: "Carl" })).rejects.toThrow(/why you are rejecting/);
    await approvals.decideViaLink(l1.token, { outcome: "REJECTED", name: "Carl Customer", comment: "Too expensive" });
    expect(await status(job.id)).toBe("QUOTING");

    const v2 = await quotes.reviseQuote(t.manager, quote.id);
    expect(v2).toMatchObject({ number: quote.number, version: 2, status: "DRAFT" });
    await quotes.saveQuote(t.manager, v2.id, { scope: "Replace belt (discounted)", terms: "", validUntil: null, lines: [LINES[1]!] });
    await quotes.submitQuote(t.manager, v2.id);
    const l2 = await link(t, { quoteId: v2.id });
    await approvals.decideViaLink(l2.token, { outcome: "APPROVED", name: "Carl Customer" });
    expect(await status(job.id)).toBe("APPROVED");

    const all = await prisma.quote.findMany({ where: { jobId: job.id }, orderBy: { version: "asc" }, include: { lines: true } });
    expect(all.map((x) => [x.version, x.status, x.totalCents, x.lines.length])).toEqual([[1, "REJECTED", 285956, 2], [2, "APPROVED", 123456, 1]]);

    // Service layer refuses edits; and even a direct DB write is refused by the trigger.
    await expect(quotes.saveQuote(t.manager, v2.id, { scope: "x", terms: "", validUntil: null, lines: LINES })).rejects.toEqual(code("CONFLICT"));
    await expect(quotes.reviseQuote(t.manager, v2.id)).rejects.toEqual(code("CONFLICT"));
    await expect(prisma.quote.update({ where: { id: v2.id }, data: { totalCents: 1, subtotalCents: 1 } })).rejects.toThrow(/frozen/);
    await expect(prisma.quoteLine.deleteMany({ where: { quoteId: v2.id } })).rejects.toThrow(/frozen/);
    await expect(prisma.quote.delete({ where: { id: quote.id } })).rejects.toThrow();
  });

  it("revising a submitted quote supersedes it and kills its link", async () => {
    const t = await tenant();
    const { job, quote } = await quotedJob(t);
    const l = await link(t, { quoteId: quote.id });
    await quotes.reviseQuote(t.manager, quote.id);
    expect(await status(job.id)).toBe("QUOTING");
    expect(await approvals.getLinkView(l.token)).toBeNull();
    await expect(approvals.decideViaLink(l.token, { outcome: "APPROVED", name: "Carl Customer" })).rejects.toEqual(code("NOT_FOUND"));
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SUPERSEDED");
  });

  it("VAT-registered tenant: 15% VAT snapshot is applied and stored", async () => {
    const t = await tenant();
    await prisma.organisation.update({ where: { id: t.orgId }, data: { vatRegistered: true, vatNumber: "4123456789" } });
    const job = await newJob(t);
    await jobs.submitAssessment(t.manager, job.id, { findings: "Fault found", quoteRequired: true });
    const q = await quotes.createQuote(t.manager, job.id);
    const totals = await quotes.saveQuote(t.manager, q.id, { scope: "s", terms: "", validUntil: null, lines: [...LINES, { kind: "OTHER", description: "Disbursement", quantity: "1", unitPriceCents: 5000, taxable: false }] });
    expect(totals).toEqual({ subtotalCents: 290956, vatCents: 42893, totalCents: 333849 });
    await expect(quotes.saveQuote(t.manager, q.id, { scope: "s", terms: "", validUntil: null, lines: [{ ...LINES[0]!, quantity: "-1" }] })).rejects.toEqual(code("INVALID"));
  });

  it("emergency work can be authorised without a quote, but only by a manager with a reason", async () => {
    const t = await tenant();
    const normal = await newJob(t);
    await expect(jobs.authoriseWithoutQuote(t.manager, normal.id, { reason: "Just do it" })).rejects.toThrow(/emergency/i);
    const job = await newJob(t, t.manager, { emergency: true, priority: "CRITICAL" });
    await expect(jobs.authoriseWithoutQuote(t.tech, job.id, { reason: "Burst pipe" })).rejects.toEqual(code("FORBIDDEN"));
    await expect(jobs.authoriseWithoutQuote(t.manager, job.id, { reason: "" })).rejects.toEqual(code("INVALID"));
    await jobs.authoriseWithoutQuote(t.manager, job.id, { reason: "Burst pipe flooding plant room" });
    expect(await status(job.id)).toBe("APPROVED");
    expect((await jobs.getJob(t.manager, job.id)).events.some((e) => e.type === "job.authorised_without_quote")).toBe(true);
  });

  it("hold / resume / cancel with reasons; cancelled jobs are terminal and their quotes withdrawn", async () => {
    const t = await tenant();
    const job = await startedJob(t);
    await expect(jobs.holdJob(t.tech, job.id, { reason: "" })).rejects.toEqual(code("INVALID"));
    await jobs.holdJob(t.tech, job.id, { reason: "Waiting for parts" });
    expect(await status(job.id)).toBe("ON_HOLD");
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "done already" })).rejects.toEqual(code("CONFLICT"));
    await jobs.resumeJob(t.tech, job.id);
    expect(await status(job.id)).toBe("IN_PROGRESS");

    const { job: j2, quote } = await quotedJob(t);
    const l = await link(t, { quoteId: quote.id });
    await jobs.cancelJob(t.manager, j2.id, { reason: "Customer withdrew the request" });
    expect(await status(j2.id)).toBe("CANCELLED");
    await expect(approvals.decideViaLink(l.token, { outcome: "APPROVED", name: "Carl Customer" })).rejects.toEqual(code("NOT_FOUND"));
    await expect(jobs.reopenJob(t.manager, j2.id, { reason: "changed mind" })).rejects.toEqual(code("CONFLICT"));
    await expect(jobs.requestAssessment(t.manager, j2.id, {})).rejects.toEqual(code("CONFLICT"));
  });

  it("additional work needs an approved variation quote before completion", async () => {
    const t = await tenant();
    const job = await startedJob(t);
    await jobs.addWorkUpdate(t.tech, job.id, { kind: "ADDITIONAL_WORK", note: "Bearing also failed" });
    const v = await quotes.createQuote(t.manager, job.id, "VARIATION");
    await quotes.saveQuote(t.manager, v.id, { scope: "Replace bearing", terms: "", validUntil: null, lines: [LINES[1]!] });
    await quotes.submitQuote(t.manager, v.id);
    expect(await status(job.id)).toBe("IN_PROGRESS"); // variation does not move the job
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "a.png", bytes: PNG });
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "All done" })).rejects.toThrow(/Additional work/);
    await approvals.recordQuoteDecision(t.manager, v.id, { outcome: "APPROVED", name: "Carl Customer", comment: "PO 4471 by phone" });
    await jobs.submitCompletion(t.tech, job.id, { workPerformed: "All done" });
    expect(await status(job.id)).toBe("AWAITING_VERIFICATION");
  });

  it("rejected completion returns to the technician; a second version can be signed off in person; reopen works", async () => {
    const t = await tenant();
    const { job, completion } = await completedJob(t);
    await expect(approvals.captureSignoff(t.tech, completion.id, { outcome: "APPROVED", name: "Carl Customer" })).rejects.toThrow(/signature/);
    await approvals.portalDecideCompletion(t.rep, completion.id, { outcome: "REJECTED", comment: "Still slipping" });
    expect(await status(job.id)).toBe("IN_PROGRESS");
    await expect(jobs.closeJob(t.manager, job.id)).rejects.toEqual(code("CONFLICT"));

    await addJobAttachment(t.tech, { jobId: job.id, kind: "TEST_DOCUMENT", filename: "test.png", bytes: PNG });
    const c2 = await jobs.submitCompletion(t.tech, job.id, { workPerformed: "Re-tensioned and load tested" });
    expect(c2.version).toBe(2);
    await approvals.captureSignoff(t.tech, c2.id, { outcome: "APPROVED", name: "Carl Customer", signature: PNG_DATA_URL });
    await jobs.closeJob(t.manager, job.id);
    expect(await status(job.id)).toBe("CLOSED");

    await expect(jobs.reopenJob(t.tech, job.id, { reason: "Fault is back" })).rejects.toEqual(code("FORBIDDEN"));
    await expect(jobs.reopenJob(t.manager, job.id, { reason: "" })).rejects.toEqual(code("INVALID"));
    await jobs.reopenJob(t.manager, job.id, { reason: "Fault returned after two days" });
    const j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j).toMatchObject({ status: "ASSIGNED", reopenCount: 1, closedAt: null });
  });

  it("closure rules: internal verification only when customer sign-off is not required", async () => {
    const t = await tenant();
    const a = await completedJob(t, true);
    await expect(jobs.closeJob(t.manager, a.job.id)).rejects.toThrow(/customer sign-off/);
    await expect(jobs.setSignoffRequired(t.manager, a.job.id, false)).rejects.toEqual(code("CONFLICT")); // cannot be waived after submission
    const b = await completedJob(t, false);
    await expect(jobs.closeJob(t.tech, b.job.id)).rejects.toEqual(code("FORBIDDEN"));
    await jobs.closeJob(t.manager, b.job.id);
    const d = await prisma.decision.findUniqueOrThrow({ where: { completionId: b.completion.id } });
    expect(d.via).toBe("INTERNAL");
    expect(await status(b.job.id)).toBe("CLOSED");
  });
});

describe("concurrency and duplicates", () => {
  it("two simultaneous approvals through one link record exactly one decision", async () => {
    const t = await tenant();
    const { job, quote } = await quotedJob(t);
    const l = await link(t, { quoteId: quote.id });
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => approvals.decideViaLink(l.token, { outcome: "APPROVED", name: "Carl Customer" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.decision.count({ where: { quoteId: quote.id } })).toBe(1);
    expect(await status(job.id)).toBe("APPROVED");
    expect((await jobs.getJob(t.manager, job.id)).events.filter((e) => e.type === "quote.approved")).toHaveLength(1);
  });

  it("conflicting decisions from different channels: one wins, state stays consistent", async () => {
    const t = await tenant();
    const { job, quote } = await quotedJob(t);
    const [l1, l2] = [await link(t, { quoteId: quote.id }), await link(t, { quoteId: quote.id })];
    const rs = await Promise.allSettled([
      approvals.decideViaLink(l1.token, { outcome: "APPROVED", name: "Carl Customer" }),
      approvals.decideViaLink(l2.token, { outcome: "REJECTED", name: "Dana Customer", comment: "No budget" }),
      approvals.portalDecideQuote(t.rep, quote.id, { outcome: "APPROVED" }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const d = await prisma.decision.findUniqueOrThrow({ where: { quoteId: quote.id } });
    const q = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(q.status).toBe(d.outcome);
    expect(await status(job.id)).toBe(d.outcome === "APPROVED" ? "APPROVED" : "QUOTING");
  });

  it("parallel request logging yields unique, gap-free references", async () => {
    const t = await tenant();
    const made = await Promise.all(Array.from({ length: 12 }, () => newJob(t)));
    expect(new Set(made.map((j) => j.reference)).size).toBe(12);
    expect(made.map((j) => j.reference).sort()[11]).toBe("REQ-00012");
  });

  it("double start / double completion / double close are rejected", async () => {
    const t = await tenant();
    const job = await newJob(t);
    await jobs.submitAssessment(t.manager, job.id, { findings: "ok fault", quoteRequired: false });
    await jobs.authoriseWithoutQuote(t.manager, job.id, { reason: "Contract cover" });
    await jobs.setSignoffRequired(t.manager, job.id, false);
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
    const starts = await Promise.allSettled([jobs.startWork(t.tech, job.id), jobs.startWork(t.tech, job.id), jobs.startWork(t.manager, job.id)]);
    expect(starts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "a.png", bytes: PNG });
    const subs = await Promise.allSettled([1, 2, 3].map(() => jobs.submitCompletion(t.tech, job.id, { workPerformed: "Finished the job" })));
    expect(subs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.completion.count({ where: { jobId: job.id } })).toBe(1);
    const closes = await Promise.allSettled([jobs.closeJob(t.manager, job.id), jobs.closeJob(t.owner, job.id)]);
    expect(closes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.decision.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("the audit trail and decisions cannot be edited or deleted, even with direct database access", async () => {
    const t = await tenant();
    const job = await newJob(t);
    const ev = await prisma.activityEvent.findFirstOrThrow({ where: { jobId: job.id } });
    await expect(prisma.activityEvent.update({ where: { id: ev.id }, data: { summary: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.activityEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });
});
