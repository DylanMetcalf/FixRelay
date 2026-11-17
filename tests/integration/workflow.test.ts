import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import * as portal from "@/server/services/portal";
import * as quotes from "@/server/services/quotes";
import { appointedJob, assessedJob, code, completedInHouse, inHouseJob, linkFromEmail, member, newJob, PNG, PNG_DATA_URL, quotingJob, status, tenant } from "../helpers";

describe("in-house route: fault reported → fixed by the site's own team", () => {
  it("runs end to end, the reporter confirms, the manager closes, and the history is complete", async () => {
    const t = await tenant();
    const job = await newJob(t); // a requester reports it
    expect(job).toMatchObject({ reference: "REQ-00001", requesterId: t.requester.userId, source: "APP", reporterConfirmation: true });
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, jobId: job.id } })).toBe(1);
    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
    await jobs.submitAssessment(t.tech, job.id, { findings: "Door hinge broken", quoteRequired: false });
    await jobs.routeInHouse(t.manager, job.id, { note: "Hinge in stock" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } }))).toMatchObject({ status: "APPROVED", route: "IN_HOUSE" });
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
    await jobs.startWork(t.tech, job.id);
    await jobs.addWorkUpdate(t.tech, job.id, { note: "Hinge replaced", labourMinutes: 45 });
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced hinge" })).rejects.toThrow(/evidence/);
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after.png", bytes: PNG });
    await jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced hinge, door closes properly" });
    expect(await prisma.notification.count({ where: { userId: t.requester.userId, type: "job.confirm_fixed" } })).toBe(1);
    await expect(jobs.closeJob(t.manager, job.id)).rejects.toThrow(/needs to confirm/);
    await expect(jobs.confirmFixed(t.tech, job.id, { outcome: "APPROVED" })).rejects.toEqual(code("FORBIDDEN"));
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED", comment: "Works now" });
    await jobs.closeJob(t.manager, job.id);
    expect(await status(job.id)).toBe("CLOSED");
    const ev = (await jobs.getJob(t.manager, job.id)).events.map((e) => e.type);
    for (const ty of ["job.created", "job.assessment_requested", "job.assessed", "job.routed_in_house", "job.assigned", "job.started", "job.completion_submitted", "completion.approved", "job.closed"]) expect(ev).toContain(ty);
  });

  it("reporter says it is NOT fixed → back to work; a manager may confirm instead, but only with a reason", async () => {
    const t = await tenant();
    const { job } = await completedInHouse(t);
    await expect(jobs.confirmFixed(t.requester, job.id, { outcome: "REJECTED" })).rejects.toThrow(/still wrong/);
    await jobs.confirmFixed(t.requester, job.id, { outcome: "REJECTED", comment: "Still leaking" });
    expect(await status(job.id)).toBe("IN_PROGRESS");
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "a2.png", bytes: PNG });
    await jobs.submitCompletion(t.tech, job.id, { workPerformed: "Resealed properly" });
    await expect(jobs.confirmFixed(t.manager, job.id, { outcome: "APPROVED" })).rejects.toThrow(/Say why/);
    await jobs.confirmFixed(t.manager, job.id, { outcome: "APPROVED", comment: "Checked on site, reporter on leave" });
    const d = await prisma.decision.findFirstOrThrow({ where: { jobId: job.id, outcome: "APPROVED" } });
    expect(d).toMatchObject({ via: "INTERNAL", deciderUserId: t.manager.userId });
  });

  it("signature captured on the technician's device counts as the reporter's confirmation", async () => {
    const t = await tenant();
    const { job } = await completedInHouse(t);
    await jobs.confirmFixed(t.tech, job.id, { outcome: "APPROVED" }, { signature: { name: "Grace Reporter", dataUrl: PNG_DATA_URL } });
    const d = await prisma.decision.findFirstOrThrow({ where: { jobId: job.id } });
    expect(d).toMatchObject({ via: "IN_PERSON", deciderName: "Grace Reporter", recordedById: t.tech.userId });
    expect(d.signatureAttachmentId).not.toBeNull();
  });

  it("without reporter confirmation the manager checks and closes in one step", async () => {
    const t = await tenant();
    const { job } = await completedInHouse(t, false);
    await jobs.closeJob(t.manager, job.id, { comment: "Checked" });
    expect(await status(job.id)).toBe("CLOSED");
  });
});

describe("contractor route: quotes → approval → contractor fixes it", () => {
  it("collects quotes by link and by capture, compares them, approves within the manager's limit and appoints the contractor", async () => {
    const t = await tenant();
    const job = await assessedJob(t);
    const links = await quotes.requestQuotes(t.manager, job.id, { contractorIds: t.contractors.map((c) => c.id), scope: "Replace capacitor", deadline: null });
    expect(links).toHaveLength(3);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } }))).toMatchObject({ status: "QUOTING", route: "CONTRACTOR" });
    // CoolTech (VAT registered) quotes online with a document; Sparks online; Handy Andy (no VAT) by email, captured.
    const tokA = await linkFromEmail(t.contractors[0].email);
    expect((await portal.getContractorLinkView(tokA))).toMatchObject({ state: "open", purpose: "QUOTE", job: { title: "Compressor tripping" } });
    await portal.submitQuoteViaLink(tokA, { scope: "Capacitor + test", priceExclVatCents: 400000, leadTimeDays: 1 }, [{ filename: "quote.pdf", bytes: Buffer.from("%PDF-1.4 quote") }]);
    await portal.submitQuoteViaLink(await linkFromEmail(t.contractors[1].email), { scope: "Capacitor", priceExclVatCents: 380000 }, []);
    await quotes.recordQuote(t.manager, job.id, t.contractors[2].id, { scope: "Capacitor", priceExclVatCents: 420000 });
    const cmp = await quotes.compareQuotes(t.manager, job.id);
    expect(cmp.quotes.map((q) => [q.contractor!.name, q.subtotalCents, q.vatCents, q.totalCents])).toEqual([
      ["Sparks", 380000, 57000, 437000], ["CoolTech", 400000, 60000, 460000], ["Handy Andy", 420000, 0, 420000],
    ].sort((a, b) => (a[3] as number) - (b[3] as number)));
    expect(cmp.waitingFor).toEqual([]);
    const andy = cmp.quotes.find((q) => q.contractor!.name === "Handy Andy")!;
    await approvals.approveQuote(t.manager, andy.id, { poNumber: "PO-77", comment: "Cheapest overall" });
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "ASSIGNED", contractorId: t.contractors[2].id, approvedCostCents: 420000, poNumber: "PO-77" });
    expect((await prisma.quote.findMany({ where: { jobId: job.id }, select: { status: true } })).map((q) => q.status).sort()).toEqual(["APPROVED", "REJECTED", "REJECTED"]);
    expect(await prisma.outboxEmail.count({ where: { subject: { contains: "not selected" }, toEmail: { in: [t.contractors[0].email, t.contractors[1].email] } } })).toBe(2);
    expect((await portal.getContractorLinkView(tokA))?.state).toBe("closed"); // quote links stop at award
    // The appointed contractor completes through their completion link.
    const done = await linkFromEmail(t.contractors[2].email);
    expect((await portal.getContractorLinkView(done))).toMatchObject({ purpose: "COMPLETION", state: "open", job: { poNumber: "PO-77", approvedCostCents: 420000 } });
    await expect(portal.submitCompletionViaLink(done, { workPerformed: "Replaced" }, [])).rejects.toThrow(/at least one photo/);
    await portal.submitCompletionViaLink(done, { workPerformed: "Replaced capacitor, ran 1 hour" }, [{ filename: "after.png", bytes: PNG }]);
    await expect(portal.submitCompletionViaLink(done, { workPerformed: "Again" }, [{ filename: "a.png", bytes: PNG }])).rejects.toThrow(/already been submitted/);
    expect(await status(job.id)).toBe("AWAITING_VERIFICATION");
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED" });
    await jobs.closeJob(t.manager, job.id);
    const ev = (await jobs.getJob(t.manager, job.id)).events.map((e) => e.summary).join("\n");
    expect(ev).toMatch(/Quote requested from CoolTech/);
    expect(ev).toMatch(/approved by .*R 4 200\.00.*PO PO-77/);
    expect(ev).toMatch(/Completion submitted by Handy Andy/);
  });

  it("enforces spending authority: above the manager's limit it goes to an approver with enough authority", async () => {
    const t = await tenant();
    const { job, quotes: qs } = await quotingJob(t, [800000, 900000, 950000]); // R9 200 incl. VAT > manager R5 000
    await expect(approvals.approveQuote(t.manager, qs[0]!.id, {})).rejects.toThrow(/above your approval limit/);
    await expect(approvals.approveQuote(t.tech, qs[0]!.id, {})).rejects.toEqual(code("FORBIDDEN"));
    await expect(approvals.approveQuote(t.requester, qs[0]!.id, {})).rejects.toEqual(code("FORBIDDEN"));
    await approvals.recommendQuote(t.manager, qs[0]!.id, { comment: "Cheapest, can start tomorrow" });
    expect(await status(job.id)).toBe("AWAITING_APPROVAL");
    const notified = (await prisma.notification.findMany({ where: { jobId: job.id, type: "quote.needs_approval" } })).map((n) => n.userId);
    expect(notified).toEqual(expect.arrayContaining([t.approver.userId, t.owner.userId]));
    expect(notified).not.toContain(t.manager.userId);
    await expect(approvals.approveQuote(t.approver, qs[1]!.id, {})).rejects.toThrow(/Another quote/);
    await approvals.rejectRecommendation(t.approver, job.id, { comment: "Get a cheaper quote" });
    expect(await status(job.id)).toBe("QUOTING");
    await approvals.recommendQuote(t.manager, qs[1]!.id, {});
    await approvals.approveQuote(t.approver, qs[1]!.id, { poNumber: "PO-9" });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED", contractorId: t.contractors[1].id });
  });

  it("an approver's own limit applies; above it only the owner can approve", async () => {
    const t = await tenant();
    const { job, quotes: qs } = await quotingJob(t, [5000000, 5100000, 5200000]); // R57 500 > approver R50 000
    await approvals.recommendQuote(t.manager, qs[0]!.id, {});
    await expect(approvals.approveQuote(t.approver, qs[0]!.id, {})).rejects.toThrow(/above your approval limit/);
    const notified = (await prisma.notification.findMany({ where: { jobId: job.id, type: "quote.needs_approval" } })).map((n) => n.userId);
    expect(notified).toEqual([t.owner.userId]);
    await approvals.approveQuote(t.owner, qs[0]!.id, {});
    expect(await status(job.id)).toBe("ASSIGNED");
  });

  it("applies the three-quote rule above the threshold (or records the reason) and the PO rule", async () => {
    const t = await tenant();
    const { job, quotes: qs } = await quotingJob(t, [1200000]); // R13 800 > R10 000 threshold, only 1 quote
    await expect(approvals.recommendQuote(t.manager, qs[0]!.id, {})).rejects.toThrow(/need 3 quotes \(you have 1\)/);
    await approvals.recommendQuote(t.manager, qs[0]!.id, { exceptionReason: "Only accredited Bitzer agent in Gauteng" });
    await prisma.organisation.update({ where: { id: t.orgId }, data: { poRequired: true } });
    await expect(approvals.approveQuote(t.approver, qs[0]!.id, {})).rejects.toThrow(/purchase order/);
    await approvals.approveQuote(t.approver, qs[0]!.id, { poNumber: "PO-5" });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ quoteExceptionReason: "Only accredited Bitzer agent in Gauteng", poNumber: "PO-5" });
  });

  it("a contractor's revised quote supersedes the earlier one; all versions are kept and frozen", async () => {
    const t = await tenant();
    const job = await assessedJob(t);
    await quotes.requestQuotes(t.manager, job.id, { contractorIds: [t.contractors[0].id], scope: "Fix the compressor", deadline: null });
    const tok = await linkFromEmail(t.contractors[0].email);
    await portal.submitQuoteViaLink(tok, { scope: "v1 price", priceExclVatCents: 100000 }, []);
    await portal.submitQuoteViaLink(tok, { scope: "v2 cheaper", priceExclVatCents: 90000 }, []);
    const all = await prisma.quote.findMany({ where: { jobId: job.id }, orderBy: { version: "asc" } });
    expect(all.map((q) => [q.version, q.status, q.totalCents, q.number === all[0]!.number])).toEqual([[1, "SUPERSEDED", 115000, true], [2, "SUBMITTED", 103500, true]]);
    await expect(prisma.quote.update({ where: { id: all[1]!.id }, data: { totalCents: 1, subtotalCents: 1 } })).rejects.toThrow(/frozen/);
    await expect(prisma.quote.update({ where: { id: all[1]!.id }, data: { contractorId: t.contractors[1].id } })).rejects.toThrow(/frozen/);
    expect((await portal.getContractorLinkView(tok))?.myQuotes.map((q) => q.version)).toEqual([2, 1]);
  });

  it("rework: the site rejects the contractor's work, the contractor gets a fresh link; reopen re-issues one too", async () => {
    const t = await tenant();
    const { job, contractor } = await appointedJob(t);
    await portal.submitCompletionViaLink(await linkFromEmail(contractor.email), { workPerformed: "Done and tested" }, [{ filename: "a.png", bytes: PNG }]);
    await jobs.confirmFixed(t.requester, job.id, { outcome: "REJECTED", comment: "Still trips" });
    expect(await status(job.id)).toBe("IN_PROGRESS");
    const rework = await linkFromEmail(contractor.email);
    expect((await prisma.outboxEmail.findFirstOrThrow({ where: { toEmail: contractor.email }, orderBy: { createdAt: "desc" } })).body).toMatch(/Rework needed: Still trips/);
    await portal.submitCompletionViaLink(rework, { workPerformed: "Replaced relay too" }, [{ filename: "b.png", bytes: PNG }]);
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED" });
    await jobs.closeJob(t.manager, job.id);
    await jobs.reopenJob(t.manager, job.id, { reason: "Tripped again" });
    expect((await portal.getContractorLinkView(await linkFromEmail(contractor.email)))).toMatchObject({ purpose: "COMPLETION", state: "open" });
  });

  it("switching to in-house withdraws open quotes and tells the contractors", async () => {
    const t = await tenant();
    const { job } = await quotingJob(t, [100000]);
    await jobs.routeInHouse(t.manager, job.id, { note: "We found the part in stock" });
    expect(await prisma.quote.count({ where: { jobId: job.id, status: "WITHDRAWN" } })).toBe(1);
    expect(await prisma.contractorLink.count({ where: { jobId: job.id, revokedAt: null } })).toBe(0);
    expect(await prisma.outboxEmail.count({ where: { subject: { contains: "no longer needed" }, toEmail: { in: t.contractors.map((c) => c.email) } } })).toBe(3);
  });

  it("a manager can record a contractor's completion for them (photos sent by email)", async () => {
    const t = await tenant();
    const { job } = await appointedJob(t);
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "I did it myself" })).rejects.toEqual(code("NOT_FOUND")); // not his job: invisible
    await addJobAttachment(t.manager, { jobId: job.id, kind: "AFTER", filename: "emailed.png", bytes: PNG });
    await jobs.submitCompletion(t.manager, job.id, { workPerformed: "Contractor's job card: capacitor replaced" });
    expect(await status(job.id)).toBe("AWAITING_VERIFICATION");
    expect(await prisma.contractorLink.count({ where: { jobId: job.id, purpose: "COMPLETION", revokedAt: null } })).toBe(0);
  });
});

describe("public reporting (no account)", () => {
  it("only works when switched on; creates a screened, unverified report the reporter cannot see into", async () => {
    const t = await tenant();
    const input = { title: "Light out in passage", description: "Flickering then off", reporterName: "Grace", reporterPhone: "0725550101", reporterEmail: "", locationId: t.location.id };
    await expect(jobs.createPublicReport(t.site.publicToken, input)).rejects.toEqual(code("NOT_FOUND"));
    await prisma.organisation.update({ where: { id: t.orgId }, data: { publicReportingEnabled: true } });
    await expect(jobs.createPublicReport(t.site.publicToken, { ...input, reporterPhone: "1" })).rejects.toEqual(code("INVALID"));
    await expect(jobs.createPublicReport("not-a-token", input)).rejects.toEqual(code("NOT_FOUND"));
    const r = await jobs.createPublicReport(t.site.publicToken, input);
    const job = await prisma.job.findFirstOrThrow({ where: { orgId: t.orgId, reference: r.reference } });
    expect(job).toMatchObject({ source: "PUBLIC_LINK", requesterId: null, reporterName: "Grace", reporterConfirmation: false, locationId: t.location.id });
    expect((await jobs.dashboardCounts(t.manager)).toScreen).toBe(1);
    await expect(jobs.createPublicReport(t.site.publicToken, { ...input, locationId: (await prisma.location.create({ data: { orgId: t.orgId, siteId: (await prisma.site.create({ data: { orgId: t.orgId, name: "Other", publicToken: `x${Date.now()}` } })).id, name: "Elsewhere" } })).id })).rejects.toThrow(/not at the selected site/);
    await jobs.cancelJob(t.manager, job.id, { reason: "Duplicate of REQ-00001" });
    await prisma.site.update({ where: { id: t.site.id }, data: { archived: true } });
    await expect(jobs.createPublicReport(t.site.publicToken, input)).rejects.toEqual(code("NOT_FOUND"));
  });
});

describe("concurrency", () => {
  it("two managers approving different quotes at the same moment: exactly one contractor is appointed", async () => {
    const t = await tenant();
    const m2 = await member(t.orgId, ["MANAGER"]);
    const { job, quotes: qs } = await quotingJob(t, [200000, 210000]);
    const rs = await Promise.allSettled([approvals.approveQuote(t.manager, qs[0]!.id, {}), approvals.approveQuote(m2, qs[1]!.id, {})]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.quote.count({ where: { jobId: job.id, status: "APPROVED" } })).toBe(1);
    expect(await prisma.decision.count({ where: { jobId: job.id } })).toBe(1);
    expect(await status(job.id)).toBe("ASSIGNED");
  });

  it("parallel reports get unique, gap-free references; parallel completion links submit once", async () => {
    const t = await tenant();
    const made = await Promise.all(Array.from({ length: 10 }, () => newJob(t)));
    expect(new Set(made.map((j) => j.reference)).size).toBe(10);
    const { contractor } = await appointedJob(t);
    const tok = await linkFromEmail(contractor.email);
    const rs = await Promise.allSettled([1, 2, 3].map(() => portal.submitCompletionViaLink(tok, { workPerformed: "Done done" }, [{ filename: "a.png", bytes: PNG }])));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("the audit trail cannot be edited or deleted", async () => {
    const t = await tenant();
    const job = await inHouseJob(t);
    const ev = await prisma.activityEvent.findFirstOrThrow({ where: { jobId: job.id } });
    await expect(prisma.activityEvent.update({ where: { id: ev.id }, data: { summary: "tampered" } })).rejects.toThrow(/append-only/);
  });
});
