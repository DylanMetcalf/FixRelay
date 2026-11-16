/**
 * Operational reporting. Every metric has a written definition (METRIC_DEFINITIONS) shown in the UI
 * and is computed directly from job / quote rows — nothing is estimated.
 * v1 aggregates in application code over the filtered rows (capped); move to SQL aggregates if tenants grow large.
 */
import { prisma } from "@/lib/db";
import { requirePerm, type Ctx } from "../permissions";
import { OPEN_STATUSES } from "../workflow";

export const METRIC_DEFINITIONS = {
  jobsOpened: "Requests whose reported date falls in the selected period.",
  jobsCompleted: "Jobs whose closed date falls in the selected period.",
  avgHoursToAssignment: "Average hours from reported to first assigned, for jobs reported in the period that have been assigned.",
  avgHoursToCompletion: "Average hours from reported to work completed, for jobs reported in the period whose work is complete.",
  outstandingQuotes: "Quotes currently awaiting a customer decision (count and total incl. VAT). Not limited by the period.",
  avgApprovalHours: "Average hours from quote submitted to customer decision, for quotes decided in the period.",
  overdueJobs: "Open jobs whose due date has passed, as of now. Not limited by the period.",
  workload: "Open jobs per responsible technician, as of now.",
  byCustomer: "Requests reported in the period, grouped by customer and site.",
  quotedVsRecorded: "For jobs closed in the period: approved quote value excl. VAT, against material cost and labour hours recorded in work updates.",
} as const;

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

export async function getReport(ctx: Ctx, f: { from: Date; to: Date; clientId?: string }) {
  requirePerm(ctx, "reports.view");
  const base = { orgId: ctx.orgId, ...(f.clientId ? { clientId: f.clientId } : {}) };
  const now = new Date();
  const [opened, closed, outstanding, decided, overdueJobs, open] = await Promise.all([
    prisma.job.findMany({
      where: { ...base, reportedAt: { gte: f.from, lt: f.to } }, take: 5000,
      select: { reportedAt: true, assignedAt: true, completedAt: true, client: { select: { name: true } }, site: { select: { name: true } } },
    }),
    prisma.job.findMany({
      where: { ...base, status: "CLOSED", closedAt: { gte: f.from, lt: f.to } }, take: 5000,
      select: { id: true, reference: true, title: true,
        quotes: { where: { status: "APPROVED" }, select: { subtotalCents: true } },
        updates: { select: { labourMinutes: true, materialCostCents: true } } },
    }),
    prisma.quote.aggregate({ where: { orgId: ctx.orgId, status: "SUBMITTED", job: base }, _count: true, _sum: { totalCents: true } }),
    prisma.quote.findMany({
      where: { orgId: ctx.orgId, job: base, status: { in: ["APPROVED", "REJECTED"] }, decidedAt: { gte: f.from, lt: f.to } },
      select: { submittedAt: true, decidedAt: true }, take: 5000,
    }),
    prisma.job.count({ where: { ...base, status: { in: OPEN_STATUSES }, dueAt: { lt: now } } }),
    prisma.job.groupBy({ by: ["leadTechnicianId"], where: { ...base, status: { in: OPEN_STATUSES }, leadTechnicianId: { not: null } }, _count: true }),
  ]);
  const techs = await prisma.user.findMany({ where: { id: { in: open.map((o) => o.leadTechnicianId!) } }, select: { id: true, name: true } });
  const groups = new Map<string, number>();
  for (const j of opened) groups.set(`${j.client.name} — ${j.site.name}`, (groups.get(`${j.client.name} — ${j.site.name}`) ?? 0) + 1);
  return {
    jobsOpened: opened.length,
    jobsCompleted: closed.length,
    avgHoursToAssignment: avg(opened.filter((j) => j.assignedAt).map((j) => hours(j.reportedAt, j.assignedAt!))),
    avgHoursToCompletion: avg(opened.filter((j) => j.completedAt).map((j) => hours(j.reportedAt, j.completedAt!))),
    outstandingQuotes: { count: outstanding._count, totalCents: outstanding._sum.totalCents ?? 0 },
    avgApprovalHours: avg(decided.filter((q) => q.submittedAt && q.decidedAt).map((q) => hours(q.submittedAt!, q.decidedAt!))),
    overdueJobs,
    workload: open.map((o) => ({ name: techs.find((t) => t.id === o.leadTechnicianId)?.name ?? "Unknown", openJobs: o._count })).sort((a, b) => b.openJobs - a.openJobs),
    byCustomer: [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    quotedVsRecorded: closed.map((j) => ({
      id: j.id, reference: j.reference, title: j.title,
      quotedCents: j.quotes.length ? j.quotes.reduce((a, q) => a + q.subtotalCents, 0) : null,
      materialCents: j.updates.reduce((a, u) => a + u.materialCostCents, 0),
      labourHours: Math.round((j.updates.reduce((a, u) => a + u.labourMinutes, 0) / 60) * 10) / 10,
    })),
  };
}
