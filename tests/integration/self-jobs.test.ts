import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import { renderJobDocument } from "@/server/pdf/render";
import { nextAction } from "@/server/workflow";
import { code, newJob, PNG, readPdf, status, tenant } from "../helpers";

const finish = async (t: Awaited<ReturnType<typeof tenant>>, jobId: string, by = t.tech) => {
  await addJobAttachment(by, { jobId, kind: "AFTER", filename: "after.png", bytes: PNG });
  return jobs.submitCompletion(by, jobId, { workPerformed: "Tightened the fitting and tested.", rootCauses: ["WEAR_AND_TEAR"] });
};

describe("one-person jobs (dual workflow)", () => {
  it("a technician reports and fixes a fault themselves; a manager signs it off; managers keep the overview", async () => {
    const t = await tenant();
    const job = await newJob(t, t.tech, { title: "Air line leaking at lathe", selfFix: true });
    expect(job).toMatchObject({ mode: "SELF", status: "IN_PROGRESS", route: "IN_HOUSE", leadTechnicianId: t.tech.userId, reporterConfirmation: false });
    expect(nextAction(job).label).toContain("one-person job");
    const n = await prisma.notification.findFirstOrThrow({ where: { jobId: job.id, userId: t.manager.userId, type: "job.created" } });
    expect(n.title).toContain("themselves");
    expect((await jobs.dashboardCounts(t.manager)).selfOpen).toBe(1);
    expect((await jobs.listJobs(t.manager, { mode: "self" })).map((j) => j.id)).toEqual([job.id]);

    await finish(t, job.id);
    expect(await status(job.id)).toBe("AWAITING_VERIFICATION");
    expect((await jobs.dashboardCounts(t.manager)).selfSignoff).toBe(1);
    expect(nextAction(await prisma.job.findUniqueOrThrow({ where: { id: job.id } }))).toEqual({ label: "Sign off the one-person job", party: "Maintenance manager" });
    await expect(jobs.closeJob(t.tech, job.id)).rejects.toEqual(code("FORBIDDEN")); // the doer does not sign off their own work here
    await jobs.closeJob(t.manager, job.id, { comment: "Checked" });
    expect(await status(job.id)).toBe("CLOSED");
    const card = await readPdf((await renderJobDocument(t.manager, job.id, "card")).bytes);
    expect(card.text).toContain("one-person job");
    const events = (await prisma.activityEvent.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["job.created", "job.self_started", "job.completion_submitted", "job.verified", "job.closed"]));
  });

  it("without the sign-off setting, the job closes as soon as the work is completed (recorded as such)", async () => {
    const t = await tenant();
    await prisma.organisation.update({ where: { id: t.orgId }, data: { selfJobSignOff: false } });
    const job = await newJob(t, t.manager, { selfFix: true });
    await finish(t, job.id, t.manager);
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id }, include: { completions: { include: { decision: true } } } });
    expect(row.status).toBe("CLOSED");
    expect(row.completions[0]!.decision).toMatchObject({ outcome: "APPROVED", via: "INTERNAL", deciderUserId: t.manager.userId });
    expect(row.completions[0]!.decision!.comment).toContain("no manager sign-off required");
    const done = await readPdf((await renderJobDocument(t.manager, job.id, "completion")).bytes);
    expect(done.text).toContain("Final status: Closed");
  });

  it("a staff member can take someone's report as a one-person job; the reporter still confirms it", async () => {
    const t = await tenant();
    const job = await newJob(t); // reported by the requester
    await jobs.takeAsSelfJob(t.manager, job.id);
    let row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ mode: "SELF", status: "IN_PROGRESS", leadTechnicianId: t.manager.userId, reporterConfirmation: true });
    expect(await prisma.notification.count({ where: { jobId: job.id, userId: t.requester.userId, type: "job.self_started" } })).toBe(1);
    await finish(t, job.id, t.manager);
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED" });
    await jobs.closeJob(t.manager, job.id);
    row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("CLOSED");
    await expect(jobs.takeAsSelfJob(t.manager, job.id)).rejects.toEqual(code("CONFLICT")); // only new or assessed jobs
  });

  it("only people who do maintenance work can take one-person jobs, and companies can switch it off", async () => {
    const t = await tenant();
    await expect(newJob(t, t.requester, { selfFix: true })).rejects.toEqual(code("FORBIDDEN"));
    expect(await prisma.job.count({ where: { orgId: t.orgId } })).toBe(0);
    await prisma.organisation.update({ where: { id: t.orgId }, data: { allowSelfJobs: false } });
    await expect(newJob(t, t.tech, { selfFix: true })).rejects.toEqual(code("FORBIDDEN"));
    const job = await newJob(t, t.tech);
    await expect(jobs.takeAsSelfJob(t.manager, job.id)).rejects.toEqual(code("FORBIDDEN"));
  });
});
