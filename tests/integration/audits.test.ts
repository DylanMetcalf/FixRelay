import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as jobs from "@/server/services/jobs";
import { markJobRead } from "@/server/services/notifications";
import * as orgs from "@/server/services/orgs";
import { getReport } from "@/server/services/reports";
import * as approvals from "@/server/services/approvals";
import { newJob, quotedJob, startedJob, tenant } from "../helpers";

const range = () => ({ from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });

describe("audit fixes: workflow", () => {
  it("a manager's note on a job alerts the assigned technician (clarification gets an answer)", async () => {
    const t = await tenant();
    const job = await startedJob(t);
    await jobs.addWorkUpdate(t.tech, job.id, { kind: "CLARIFICATION", note: "Which breaker panel?" });
    await jobs.addWorkUpdate(t.manager, job.id, { kind: "NOTE", note: "Panel B in the plant room." });
    expect(await prisma.notification.count({ where: { userId: t.tech.userId, jobId: job.id, type: "work.manager_note" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, type: "work.manager_note" } })).toBe(0);
  });

  it("removing a technician reports how many open jobs they still lead", async () => {
    const t = await tenant();
    await startedJob(t); await startedJob(t);
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: t.tech.userId } });
    const r = await orgs.updateMember(t.owner, m.id, { roles: ["TECHNICIAN"], active: false });
    expect(r).toMatchObject({ openJobsToReassign: 2 });
  });

  it("opening a job clears that person's alerts for it only", async () => {
    const t = await tenant();
    const a = await newJob(t, t.rep);
    const b = await newJob(t, t.rep);
    await markJobRead(t.manager, a.id);
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, jobId: a.id, readAt: null } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, jobId: b.id, readAt: null } })).toBe(1);
  });
});

describe("audit fixes: reporting", () => {
  it("measures first response against the priority target, quote win rate and reopened jobs", async () => {
    const t = await tenant();
    const quick = await newJob(t, t.manager, { priority: "HIGH" });
    await jobs.requestAssessment(t.manager, quick.id, {});
    expect((await prisma.job.findUniqueOrThrow({ where: { id: quick.id } })).respondedAt).not.toBeNull();
    const slow = await newJob(t, t.manager, { priority: "CRITICAL" }); // 2h target
    await prisma.job.update({ where: { id: slow.id }, data: { reportedAt: new Date(Date.now() - 3 * 3_600_000) } }); // never responded, now late

    const won = await quotedJob(t);
    await approvals.recordQuoteDecision(t.manager, won.quote.id, { outcome: "APPROVED", name: "Carl C", comment: "PO 1" });
    const lost = await quotedJob(t);
    await approvals.recordQuoteDecision(t.manager, lost.quote.id, { outcome: "REJECTED", name: "Carl C", comment: "Too dear" });

    const r = await getReport(t.manager, range());
    expect(r.respondedOnTime.late).toBeGreaterThanOrEqual(1);
    expect(r.respondedOnTime.onTime).toBeGreaterThanOrEqual(3);
    expect(r.quoteWinRate).toMatchObject({ won: 1, decided: 2, pct: 50 });
    expect(r.reopened.count).toBe(0);
  });
});
