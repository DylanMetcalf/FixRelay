import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { departmentsOf } from "@/server/auth";
import { duplicateScore, findLikelyDuplicates, words } from "@/server/duplicates";
import * as departments from "@/server/services/departments";
import * as jobs from "@/server/services/jobs";
import type { Ctx } from "@/server/permissions";
import { code, completedInHouse, member, newJob, status, tenant } from "../helpers";

const withDepts = async (c: Ctx): Promise<Ctx> => ({ ...c, ...(await departmentsOf(c.orgId, c.userId)) });

describe("departments and handovers", () => {
  it("only the administrator manages departments; names are unique; archived only when no open work", async () => {
    const t = await tenant();
    await expect(departments.createDepartment(t.manager, { name: "Operations" })).rejects.toEqual(code("FORBIDDEN"));
    const ops = await departments.createDepartment(t.owner, { name: "Operations" });
    await expect(departments.createDepartment(t.owner, { name: "Operations" })).rejects.toEqual(code("CONFLICT"));
    await departments.setDepartmentMember(t.owner, ops.id, { userId: t.tech.userId, isManager: false });
    const other = await tenant();
    await expect(departments.setDepartmentMember(t.owner, ops.id, { userId: other.tech.userId, isManager: false })).rejects.toEqual(code("INVALID"));
    const job = await newJob(t, t.requester, { departmentId: ops.id });
    await expect(departments.archiveDepartment(t.owner, ops.id)).rejects.toEqual(code("CONFLICT"));
    await jobs.cancelJob(t.manager, job.id, { reason: "test" });
    await departments.archiveDepartment(t.owner, ops.id);
    expect((await departments.listDepartments(t.owner)).map((d) => d.name)).not.toContain("Operations");
  });

  it("a department manager sees their department's jobs, hands one over with a reason, and only the receiver is told", async () => {
    const t = await tenant();
    const maint = await departments.createDepartment(t.owner, { name: "Maintenance" });
    const ops = await departments.createDepartment(t.owner, { name: "Operations" });
    const opsBoss = await member(t.orgId, ["REQUESTER"], [], "opsboss");
    const maintBoss = await member(t.orgId, ["TECHNICIAN"], [], "maintboss");
    await departments.setDepartmentMember(t.owner, ops.id, { userId: opsBoss.userId, isManager: true });
    await departments.setDepartmentMember(t.owner, maint.id, { userId: maintBoss.userId, isManager: true });
    const job = await newJob(t, t.requester, { departmentId: maint.id });

    const mb = await withDepts(maintBoss);
    const ob = await withDepts(opsBoss);
    expect((await jobs.listJobs(mb, {})).map((j) => j.id)).toContain(job.id); // the department's queue
    await expect(jobs.getJob(ob, job.id)).rejects.toEqual(code("NOT_FOUND")); // another department's work
    await expect(departments.handOverJob(t.tech, job.id, { toDepartmentId: ops.id, reason: "Take it over" })).rejects.toEqual(code("NOT_FOUND"));
    await expect(departments.handOverJob(mb, job.id, { toDepartmentId: ops.id, reason: "" })).rejects.toEqual(code("INVALID"));
    await expect(departments.handOverJob(mb, job.id, { reason: "Nobody chosen" })).rejects.toEqual(code("INVALID"));

    await departments.handOverJob(mb, job.id, { toDepartmentId: ops.id, reason: "Production must clear the line first" });
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.departmentId).toBe(ops.id);
    const h = await prisma.jobHandover.findFirstOrThrow({ where: { jobId: job.id } });
    expect(h).toMatchObject({ fromDepartmentId: maint.id, toDepartmentId: ops.id, byUserId: maintBoss.userId, reason: "Production must clear the line first" });
    expect(await prisma.notification.count({ where: { userId: opsBoss.userId, type: "job.handover" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, type: "job.handover" } })).toBe(0); // no spam
    expect((await jobs.getJob(ob, job.id)).id).toBe(job.id); // now theirs
    await expect(departments.handOverJob(mb, job.id, { toDepartmentId: maint.id, reason: "Back to us" })).rejects.toEqual(code("NOT_FOUND")); // no longer theirs
    await expect(prisma.jobHandover.update({ where: { id: h.id }, data: { reason: "edited" } })).rejects.toThrow(); // append-only

    // Handing to a person makes them responsible and lets them see the job.
    await departments.handOverJob(t.manager, job.id, { toUserId: t.approver.userId, reason: "Approve the downtime" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).ownerId).toBe(t.approver.userId);
    const timeline = await prisma.activityEvent.findMany({ where: { jobId: job.id, type: "job.handover" } });
    expect(timeline).toHaveLength(2);
    // Email for the receiver links straight to the job.
    const mail = await prisma.outboxEmail.findFirstOrThrow({ where: { toEmail: opsBoss.userEmail } });
    expect(mail.body).toContain(`http://test.local/jobs/${job.id}`);
  });
});

describe("duplicate reports and repeat faults", () => {
  it("scores reports by place, machine, wording and time", () => {
    expect([...words("The compressor keeps tripping!")]).toEqual(["compressor", "tripp"]);
    const base = { id: "a", title: "Compressor tripping", description: "Trips after 20 minutes", locationId: "L1", assetId: "M1", category: "Electrical", reportedAt: new Date() };
    expect(duplicateScore(base, { ...base, id: "b", locationId: "L2" })).toBeNull(); // another area
    expect(duplicateScore(base, { ...base, id: "b", assetId: "M2" })).toBeNull(); // another machine
    const same = findLikelyDuplicates(base, [{ ...base, id: "b", title: "Compressor 2 tripping again", description: "It trips after running" }]);
    expect(same[0]).toMatchObject({ id: "b", reasons: expect.arrayContaining(["same equipment", "similar description"]) });
    expect(findLikelyDuplicates(base, [{ ...base, id: "c", title: "Door handle loose", description: "Office door handle wobbles", assetId: null }])).toEqual([]);
  });

  it("flags a likely duplicate for review; a manager links it (kept on record) or dismisses the warning", async () => {
    const t = await tenant();
    const first = await newJob(t);
    const second = await newJob(t, t.manager, { title: "Compressor 2 tripping again", description: "Trips after about 20 minutes of running." });
    let row = await prisma.job.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.duplicateStatus).toBe("FLAGGED");
    expect(row.possibleDuplicateIds).toEqual([first.id]);
    expect((await jobs.dashboardCounts(t.manager)).duplicates).toBe(1);
    expect((await jobs.listJobs(t.manager, { duplicates: "flagged" })).map((j) => j.id)).toEqual([second.id]);
    const n = await prisma.notification.findFirstOrThrow({ where: { jobId: second.id, type: "job.created", userId: t.owner.userId } });
    expect(n.body).toContain(`Possible duplicate of ${first.reference}`);

    await expect(jobs.linkDuplicate(t.tech, second.id, first.id)).rejects.toEqual(code("FORBIDDEN"));
    await jobs.linkDuplicate(t.manager, second.id, first.id);
    row = await prisma.job.findUniqueOrThrow({ where: { id: second.id } });
    expect(row).toMatchObject({ duplicateStatus: "LINKED", duplicateOfId: first.id, status: "CANCELLED", cancelReason: `Duplicate of ${first.reference}` });
    expect(await prisma.activityEvent.count({ where: { jobId: first.id, type: "duplicate.received" } })).toBe(1);
    await expect(jobs.linkDuplicate(t.manager, first.id, first.id)).rejects.toEqual(code("INVALID"));

    const third = await newJob(t, t.manager, { title: "Compressor 2 tripping on overload", description: "Trips after 20 minutes, cold room warming" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: third.id } })).duplicateStatus).toBe("FLAGGED");
    await jobs.dismissDuplicate(t.manager, third.id);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: third.id } })).toMatchObject({ duplicateStatus: "DISMISSED", status: "NEW" });
    await expect(jobs.dismissDuplicate(t.manager, third.id)).rejects.toEqual(code("CONFLICT"));
  });

  it("a repeat fault after a closed job is linked both ways; a double submit creates one job", async () => {
    const t = await tenant();
    const { job } = await completedInHouse(t);
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED" });
    await jobs.closeJob(t.manager, job.id);
    const again = await newJob(t, t.requester, { title: "Compressor tripping again", repeatOfId: job.id, submissionKey: "form-key-1234" });
    expect(again.repeatOfId).toBe(job.id);
    expect(await prisma.activityEvent.count({ where: { jobId: job.id, type: "job.repeat_reported" } })).toBe(1);
    expect(await status(job.id)).toBe("CLOSED"); // the closure record is untouched
    const twice = await newJob(t, t.requester, { title: "Compressor tripping again", repeatOfId: job.id, submissionKey: "form-key-1234" });
    expect(twice.id).toBe(again.id);
    const [a, b] = await Promise.all([newJob(t, t.requester, { submissionKey: "parallel-key-99" }), newJob(t, t.requester, { submissionKey: "parallel-key-99" })]);
    expect(a.id).toBe(b.id);
    const other = await tenant();
    await expect(newJob(other, other.requester, { repeatOfId: job.id })).rejects.toEqual(code("INVALID")); // never across companies
  });
});
