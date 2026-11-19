import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import { nextAction } from "@/server/workflow";
import { code, member, newJob, PNG, tenant } from "../helpers";

const notes = (userId: string, type: string) => prisma.notification.count({ where: { userId, type } });

describe("priority when reporting", () => {
  it("public (QR) reports keep the priority the reporter chose and flag critical ones to managers", async () => {
    const t = await tenant();
    await prisma.organisation.update({ where: { id: t.orgId }, data: { publicReportingEnabled: true } });
    const r = await jobs.createPublicReport(t.site.publicToken, { title: "Freezer door won't close", description: "Gap at the bottom", priority: "CRITICAL", reporterName: "Sipho", reporterPhone: "0725550101", reporterEmail: "", locationId: t.location.id });
    const job = await prisma.job.findFirstOrThrow({ where: { orgId: t.orgId, reference: r.reference } });
    expect(job.priority).toBe("CRITICAL");
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: t.manager.userId, jobId: job.id } });
    expect(n.title).toMatch(/^CRITICAL: /);
    await expect(jobs.createPublicReport(t.site.publicToken, { title: "x", description: "Some issue", priority: "PANIC" as "LOW", reporterName: "Sipho", reporterPhone: "0725550101", reporterEmail: "" })).rejects.toEqual(code("INVALID"));
  });

  it("the open board lists critical first, counts each priority, and history holds finished jobs; cards carry the first photo", async () => {
    const t = await tenant();
    const low = await newJob(t, t.requester, { title: "Paint chipped", priority: "LOW" });
    const crit = await newJob(t, t.requester, { title: "Gas smell", priority: "CRITICAL" });
    const mid = await newJob(t, t.requester, { title: "Door sticks", priority: "NORMAL" });
    await addJobAttachment(t.requester, { jobId: crit.id, kind: "REQUEST", filename: "p.png", bytes: PNG });
    await jobs.cancelJob(t.manager, low.id, { reason: "Not needed" });

    const open = await jobs.listJobs(t.manager, { tab: "open" });
    expect(open.map((j) => j.title)).toEqual(["Gas smell", "Door sticks"]);
    expect(open[0]!.photoId).toBeTruthy();
    expect(open[1]!.photoId).toBeNull();
    expect(await jobs.priorityCounts(t.manager, { tab: "open" })).toMatchObject({ CRITICAL: 1, NORMAL: 1, LOW: 0, all: 2 });
    expect((await jobs.listJobs(t.manager, { tab: "open", priority: "CRITICAL" })).map((j) => j.id)).toEqual([crit.id]);
    const history = await jobs.listJobs(t.manager, { tab: "history" });
    expect(history.map((j) => j.id)).toEqual([low.id]);
    expect(mid.id).toBeTruthy();
  });
});

describe("spares and stores", () => {
  it("spares asked for at the assessment notify stores and managers; stores issue, order and receive them", async () => {
    const t = await tenant();
    const stores = await member(t.orgId, ["STORES"]);
    const otherSiteStores = await member(t.orgId, ["STORES"], [(await prisma.site.create({ data: { orgId: t.orgId, name: "Other plant", publicToken: `s${Date.now()}` } })).id]);
    const job = await newJob(t);
    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
    await expect(jobs.submitAssessment(t.tech, job.id, { findings: "Bearing worn", quoteRequired: false, sparesNeeded: "TO_BUY", sparesList: "" })).rejects.toThrow(/spares/i);
    await jobs.submitAssessment(t.tech, job.id, { findings: "Bearing worn", quoteRequired: false, sparesNeeded: "TO_BUY", sparesList: "2 × 6204 bearings" });

    expect(await notes(stores.userId, "spares.requested")).toBe(1);
    expect(await notes(t.manager.userId, "spares.requested")).toBe(1);
    expect(await notes(otherSiteStores.userId, "spares.requested")).toBe(0); // other site
    expect(await notes(t.tech.userId, "spares.requested")).toBe(0); // the person who asked

    // Stores see only jobs that need spares.
    expect((await jobs.listJobs(stores, {})).map((j) => j.id)).toEqual([job.id]);
    const unrelated = await newJob(t);
    await expect(jobs.getJob(stores, unrelated.id)).rejects.toEqual(code("NOT_FOUND"));
    expect((await jobs.dashboardCounts(t.manager)).sparesWaiting).toBe(1);

    // Nobody else moves the spares on; wrong steps are refused.
    await expect(jobs.updateSpares(t.tech, job.id, { action: "ORDERED", note: "Supplier" })).rejects.toEqual(code("FORBIDDEN"));
    await expect(jobs.updateSpares(stores, job.id, { action: "RECEIVED" })).rejects.toEqual(code("CONFLICT"));
    await expect(jobs.updateSpares(stores, job.id, { action: "ORDERED", note: "" })).rejects.toThrow(/ordered from/);

    await jobs.routeInHouse(t.manager, job.id);
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
    const assigned = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(nextAction(assigned)).toEqual({ label: "Order the spares", party: "Stores" });

    await jobs.updateSpares(stores, job.id, { action: "ORDERED", note: "Bearing Man, PO 4471", eta: "2026-12-01" });
    let j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j).toMatchObject({ sparesStatus: "ORDERED", sparesNote: "Bearing Man, PO 4471" });
    expect(j.sparesEta?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(await notes(t.tech.userId, "spares.updated")).toBe(1);

    await jobs.updateSpares(stores, job.id, { action: "RECEIVED", note: "In the workshop" });
    j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.sparesStatus).toBe("READY");
    expect(nextAction(j).party).toBe("Technician");
    expect((await jobs.dashboardCounts(t.manager)).sparesWaiting).toBe(0);
    const events = await prisma.activityEvent.findMany({ where: { jobId: job.id, type: { startsWith: "spares." } }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["spares.requested", "spares.ordered", "spares.received"]);
  });

  it("a technician can ask for more spares mid-job; stores issue them from stock", async () => {
    const t = await tenant();
    const stores = await member(t.orgId, ["STORES"]);
    const job = await newJob(t);
    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
    await jobs.submitAssessment(t.tech, job.id, { findings: "Belt slipping", quoteRequired: false });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).sparesStatus).toBe("NOT_NEEDED");
    await jobs.routeInHouse(t.manager, job.id);
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
    await jobs.startWork(t.tech, job.id);

    const outsider = await member(t.orgId, ["TECHNICIAN"]);
    await expect(jobs.requestSpares(outsider, job.id, { sparesNeeded: "ON_HAND", sparesList: "Drive belt" })).rejects.toEqual(code("NOT_FOUND")); // not on this job
    await jobs.requestSpares(t.tech, job.id, { sparesNeeded: "ON_HAND", sparesList: "1 m drive belt" });
    await expect(jobs.requestSpares(t.tech, job.id, { sparesNeeded: "ON_HAND", sparesList: "Again" })).rejects.toEqual(code("CONFLICT"));
    expect(await notes(stores.userId, "spares.requested")).toBe(1);
    await jobs.updateSpares(stores, job.id, { action: "ISSUED", note: "Given to tech" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).sparesStatus).toBe("READY");
    // Stores cannot do the maintenance work itself.
    await expect(jobs.changePriority(stores, job.id, "HIGH")).rejects.toEqual(code("FORBIDDEN"));
  });
});
