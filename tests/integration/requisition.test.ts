import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import * as orgs from "@/server/services/orgs";
import * as portal from "@/server/services/portal";
import * as quotes from "@/server/services/quotes";
import * as sites from "@/server/services/sites";
import { appointedJob, linkFromEmail, newJob, PNG, PNG_DATA_URL, status, tenant } from "../helpers";

const SIG = PNG_DATA_URL;
const steps = async (jobId: string) => (await prisma.jobSignature.findMany({ where: { jobId }, orderBy: { signedAt: "asc" } })).map((s) => `${s.step}:${s.name}`);

describe("maintenance work requisition", () => {
  it("records a signature on every line, with automatic date and time, when the company requires them", async () => {
    const t = await tenant();
    await orgs.setRequisitionSettings(t.owner, { referencePrefix: "", nextNumber: 12600, requireSignatures: true });

    // Submitted by
    await expect(newJob(t)).rejects.toThrow(/sign the report/);
    const job = await jobs.createJob(t.requester, { title: "Window broken in canteen", description: "Cracked pane next to the door.", siteId: t.site.id, locationId: t.location.id, isProject: false }, SIG);
    expect(job.reference).toBe("12600");
    // Submitted to (received by maintenance)
    await expect(jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId })).rejects.toThrow(/received/);
    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId }, SIG);
    await jobs.submitAssessment(t.tech, job.id, { findings: "Pane cracked, frame fine.", quoteRequired: false });
    await jobs.routeInHouse(t.manager, job.id);
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
    await jobs.startWork(t.tech, job.id);
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after.png", bytes: PNG });
    // Work completed by – root cause required
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced the pane.", rootCauses: [] }, SIG)).rejects.toThrow(/root cause/);
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced the pane.", rootCauses: ["HUMAN_ERROR"] })).rejects.toThrow(/complete/);
    await jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced the pane.", rootCauses: ["HUMAN_ERROR", "OTHER"], rootCauseNotes: "Trolley hit the window." }, SIG);
    // Confirmed by originator
    await expect(jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED" })).rejects.toThrow(/resolved/);
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED" }, { reporterSignature: SIG });
    // Confirmed by manager
    await expect(jobs.closeJob(t.manager, job.id)).rejects.toThrow(/close/);
    await jobs.closeJob(t.manager, job.id, {}, SIG);
    expect(await status(job.id)).toBe("CLOSED");

    expect(await steps(job.id)).toEqual([
      `REPORTED:${t.requester.userName}`, `RECEIVED:${t.manager.userName}`, `COMPLETED:${t.tech.userName}`, `ORIGINATOR:${t.requester.userName}`, `MANAGER:${t.manager.userName}`,
    ]);
    const c = await prisma.completion.findFirstOrThrow({ where: { jobId: job.id } });
    expect(c).toMatchObject({ rootCauses: ["HUMAN_ERROR", "OTHER"], rootCauseNotes: "Trolley hit the window." });
    const all = await prisma.jobSignature.findMany({ where: { jobId: job.id } });
    expect(all.every((s) => s.signedAt.getTime() > Date.now() - 60_000)).toBe(true); // stamped by the server
    const files = await prisma.attachment.findMany({ where: { id: { in: all.map((s) => s.attachmentId) } } });
    expect(files.every((f) => f.kind === "SIGNATURE" && f.mimeType === "image/png")).toBe(true);
    // Signatures are evidence: they cannot be changed or removed, even with raw SQL.
    await expect(prisma.jobSignature.update({ where: { id: all[0]!.id }, data: { name: "Someone else" } })).rejects.toThrow();
    await expect(prisma.jobSignature.delete({ where: { id: all[0]!.id } })).rejects.toThrow();
    // Insights count the root causes.
    const { getReport } = await import("@/server/services/reports");
    const r = await getReport(t.owner, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(r.rootCauses.map((x) => x.label).sort()).toEqual(["Human error", "Other"]);
  });

  it("signatures stay optional by default; anything that is drawn is still recorded", async () => {
    const t = await tenant();
    const job = await newJob(t, t.requester, { isProject: true });
    expect(job.isProject).toBe(true);
    expect(job.reference).toMatch(/^REQ-\d{5}$/);
    await jobs.requestAssessment(t.manager, job.id, {}, SIG);
    expect(await steps(job.id)).toEqual([`RECEIVED:${t.manager.userName}`]);
    await expect(jobs.createJob(t.requester, { title: "Bad signature", description: "Not a PNG", siteId: t.site.id }, "data:image/png;base64,AAAA")).rejects.toThrow(/could not be read/);
  });

  it("quote sign-off and the contractor's own completion are signed too", async () => {
    const t = await tenant();
    await orgs.setRequisitionSettings(t.owner, { referencePrefix: "REQ-", nextNumber: null, requireSignatures: true });
    // Reporting and receiving need signatures now, so build the quoting job step by step.
    const job = await jobs.createJob(t.requester, { title: "Compressor tripping", description: "Trips after 20 minutes.", siteId: t.site.id, locationId: t.location.id }, SIG);
    await jobs.submitAssessment(t.manager, job.id, { findings: "Capacitor degraded", quoteRequired: true }, SIG);
    const qs = [await quotes.recordQuote(t.manager, job.id, t.contractors[0].id, { scope: "Replace capacitor", priceExclVatCents: 300000 })];
    await expect(approvals.approveQuote(t.manager, qs[0]!.id, { poNumber: "PO-9" })).rejects.toThrow(/approve this quote/);
    await approvals.approveQuote(t.manager, qs[0]!.id, { poNumber: "PO-9" }, SIG);
    const decision = await prisma.decision.findFirstOrThrow({ where: { quoteId: qs[0]!.id } });
    expect(decision.signatureAttachmentId).not.toBeNull();
    const token = await linkFromEmail(t.contractors[0].email);
    const done = { workPerformed: "Replaced capacitor, ran 1 hour", rootCauses: ["AGE_OF_MACHINE" as const], signerName: "Sipho Dlamini" };
    await expect(portal.submitCompletionViaLink(token, done, [{ filename: "after.png", bytes: PNG }])).rejects.toThrow(/complete/);
    // The failed attempt did not use up the single-use link.
    await portal.submitCompletionViaLink(token, done, [{ filename: "after.png", bytes: PNG }], SIG, "203.0.113.9");
    const s = await prisma.jobSignature.findMany({ where: { jobId: job.id }, orderBy: { signedAt: "asc" } });
    expect(s.map((x) => x.step)).toContain("APPROVAL");
    expect(s.find((x) => x.step === "COMPLETED")).toMatchObject({ name: "Sipho Dlamini (CoolTech)", userId: null, ip: "203.0.113.9" });
  });

  it("food-handling areas need the tools/clean-area answer; other areas don't", async () => {
    const t = await tenant();
    const kitchen = await sites.createLocation(t.owner, { siteId: t.site.id, name: "Food Hall", foodArea: true });
    const job = await jobs.createJob(t.requester, { title: "Fryer not heating", description: "Oil stays cold.", siteId: t.site.id, locationId: kitchen.id });
    await jobs.submitAssessment(t.manager, job.id, { findings: "Element failed", quoteRequired: false });
    await jobs.routeInHouse(t.manager, job.id);
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
    await jobs.startWork(t.tech, job.id);
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after.png", bytes: PNG });
    await expect(jobs.submitCompletion(t.tech, job.id, { workPerformed: "New element fitted", rootCauses: ["BREAKDOWN"] })).rejects.toThrow(/food-handling/);
    await jobs.submitCompletion(t.tech, job.id, { workPerformed: "New element fitted", rootCauses: ["BREAKDOWN"], toolsAndAreaOk: true });
    expect((await prisma.completion.findFirstOrThrow({ where: { jobId: job.id } })).toolsAndAreaOk).toBe(true);
    // Toggle off again (managers only).
    await expect(sites.setFoodArea(t.tech, kitchen.id, false)).rejects.toThrow();
    await sites.setFoodArea(t.manager, kitchen.id, false);
  });

  it("requisition numbers continue a paper book and can never go backwards; public reports are signed too", async () => {
    const t = await tenant();
    await newJob(t);
    await expect(orgs.setRequisitionSettings(t.owner, { referencePrefix: "", nextNumber: 1, requireSignatures: false })).rejects.toThrow(/higher/);
    await expect(orgs.setRequisitionSettings(t.manager, { referencePrefix: "", nextNumber: 500, requireSignatures: false })).rejects.toThrow();
    await expect(orgs.setRequisitionSettings(t.owner, { referencePrefix: "<b>", nextNumber: null, requireSignatures: false })).rejects.toThrow(/letters/);
    await orgs.setRequisitionSettings(t.owner, { referencePrefix: "SP/", nextNumber: 12600, requireSignatures: true });
    expect((await jobs.createJob(t.requester, { title: "Light out", description: "Passage light", siteId: t.site.id }, SIG)).reference).toBe("SP/12600");
    await prisma.organisation.update({ where: { id: t.orgId }, data: { publicReportingEnabled: true } });
    const report = { title: "Door handle loose", description: "Main entrance", reporterName: "Visitor Vee", reporterPhone: "082 000 0000" };
    await expect(jobs.createPublicReport(t.site.publicToken, report)).rejects.toThrow(/sign/);
    const r = await jobs.createPublicReport(t.site.publicToken, report, SIG, "198.51.100.7");
    expect(r.reference).toBe("SP/12601");
    const job = await prisma.job.findFirstOrThrow({ where: { orgId: t.orgId, reference: "SP/12601" } });
    expect(await steps(job.id)).toEqual(["REPORTED:Visitor Vee"]);
    // Appointed-contractor helper still works without signatures when they are optional (regression guard).
    const t2 = await tenant();
    await appointedJob(t2);
  });
});
