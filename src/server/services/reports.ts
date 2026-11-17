/**
 * Operational reporting for site maintenance. Every metric has a written definition (METRIC_DEFINITIONS) shown
 * in the UI and is computed from job / quote / link rows — nothing is estimated. "Spend" = the approved quote
 * value (incl. VAT) of contractor jobs; in-house labour and materials are reported separately from work updates.
 * v1 aggregates in application code over the filtered rows (capped); move to SQL aggregates for very large sites.
 */
import { prisma } from "@/lib/db";
import { requirePerm, siteFilter, type Ctx } from "../permissions";
import { OPEN_STATUSES } from "../workflow";

export const METRIC_DEFINITIONS = {
  jobsOpened: "Faults reported in the selected period.",
  jobsCompleted: "Jobs closed in the selected period.",
  avgHoursToAssignment: "Average hours from reported to assigned (technician or appointed contractor), for faults reported in the period that have been assigned.",
  avgHoursToCompletion: "Average hours from reported to work completed, for faults reported in the period whose work is complete.",
  respondedOnTime: "Share of faults reported in the period whose first response (first move out of “New”) happened within the response time set for their priority. Faults not yet responded to and already past their target count as late.",
  overdueJobs: "Open jobs whose due date has passed, as of now. Not limited by the period.",
  awaitingApproval: "Quotes currently waiting for spend approval (count and value incl. VAT), as of now.",
  approvalTurnaround: "Average hours from a quote being received to it being approved, for quotes approved in the period.",
  spend: "Approved contractor quote value (incl. VAT) of contractor jobs closed in the period.",
  routeSplit: "Jobs closed in the period, by who fixed them: in-house team or external contractor.",
  spendBySite: "Approved contractor spend (incl. VAT) of jobs closed in the period, per site.",
  spendByAsset: "Approved contractor spend (incl. VAT) of jobs closed in the period, per piece of equipment (top 10).",
  contractorPerformance: "Per contractor, for quote requests sent and jobs closed in the period: requests, quotes returned, quotes won, average hours to respond, average days from appointment to completion, jobs reopened, spend.",
  workload: "Open in-house jobs per responsible technician, as of now.",
  byLocation: "Faults reported in the period, grouped by site and location.",
  reopened: "Jobs reopened in the period after being closed (a rework indicator), and that number as a share of jobs closed in the period.",
  inHouseCosts: "For in-house jobs closed in the period: labour hours and material cost recorded in work updates.",
} as const;

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

export async function getReport(ctx: Ctx, f: { from: Date; to: Date; siteId?: string }) {
  requirePerm(ctx, "reports.view");
  const sites = siteFilter(ctx);
  const base = { orgId: ctx.orgId, ...sites, ...(f.siteId && (!ctx.siteIds.length || ctx.siteIds.includes(f.siteId)) ? { siteId: f.siteId } : {}) };
  const period = { gte: f.from, lt: f.to };
  const now = new Date();
  const [opened, closed, pending, approved, overdueJobs, open, rules, reopenedCount, links] = await Promise.all([
    prisma.job.findMany({ where: { ...base, reportedAt: period }, take: 5000,
      select: { reportedAt: true, assignedAt: true, completedAt: true, respondedAt: true, priority: true, site: { select: { name: true } }, location: { select: { name: true } } } }),
    prisma.job.findMany({ where: { ...base, status: "CLOSED", closedAt: period }, take: 5000,
      select: { id: true, reference: true, title: true, route: true, approvedCostCents: true, contractorId: true, assignedAt: true, completedAt: true, reopenCount: true,
        site: { select: { name: true } }, asset: { select: { id: true, name: true, reference: true } }, updates: { select: { labourMinutes: true, materialCostCents: true } } } }),
    prisma.job.findMany({ where: { ...base, status: "AWAITING_APPROVAL" }, select: { recommendedQuoteId: true } }),
    prisma.quote.findMany({ where: { orgId: ctx.orgId, job: base, status: "APPROVED", decidedAt: period }, select: { submittedAt: true, decidedAt: true }, take: 5000 }),
    prisma.job.count({ where: { ...base, status: { in: OPEN_STATUSES }, dueAt: { lt: now } } }),
    prisma.job.groupBy({ by: ["leadTechnicianId"], where: { ...base, route: { not: "CONTRACTOR" }, status: { in: OPEN_STATUSES }, leadTechnicianId: { not: null } }, _count: true }),
    prisma.priorityRule.findMany({ where: { orgId: ctx.orgId } }),
    prisma.activityEvent.count({ where: { orgId: ctx.orgId, type: "job.reopened", createdAt: period, job: base } }),
    prisma.contractorLink.findMany({ where: { orgId: ctx.orgId, purpose: "QUOTE", createdAt: period, job: base }, select: { contractorId: true, jobId: true, createdAt: true } }),
  ]);
  const pendingQuotes = await prisma.quote.findMany({ where: { id: { in: pending.map((p) => p.recommendedQuoteId!).filter(Boolean) } }, select: { totalCents: true } });
  const target = (p: string) => (rules.find((r) => r.priority === p)?.responseHours ?? 24) * 3_600_000;
  let onTime = 0, late = 0;
  for (const j of opened) {
    const due = j.reportedAt.getTime() + target(j.priority);
    if (j.respondedAt) (j.respondedAt.getTime() <= due ? onTime++ : late++);
    else if (now.getTime() > due) late++;
  }
  const contractorJobs = closed.filter((j) => j.route === "CONTRACTOR");
  const inHouseJobs = closed.filter((j) => j.route !== "CONTRACTOR");
  const spendBySite = new Map<string, number>(); const spendByAsset = new Map<string, number>(); const byLocation = new Map<string, number>();
  for (const j of contractorJobs) { inc(spendBySite, j.site.name, j.approvedCostCents ?? 0); if (j.asset) inc(spendByAsset, `${j.asset.reference} – ${j.asset.name}`, j.approvedCostCents ?? 0); }
  for (const j of opened) inc(byLocation, `${j.site.name}${j.location ? ` — ${j.location.name}` : ""}`);

  // Contractor performance
  const contractorIds = [...new Set([...links.map((l) => l.contractorId), ...contractorJobs.map((j) => j.contractorId!).filter(Boolean)])];
  const [contractors, quotes] = await Promise.all([
    prisma.contractor.findMany({ where: { id: { in: contractorIds } }, select: { id: true, name: true } }),
    prisma.quote.findMany({ where: { orgId: ctx.orgId, contractorId: { in: contractorIds }, jobId: { in: [...new Set(links.map((l) => l.jobId))] } }, select: { contractorId: true, jobId: true, submittedAt: true, status: true, version: true } }),
  ]);
  const performance = contractors.map((c) => {
    const mine = links.filter((l) => l.contractorId === c.id);
    const firstQuote = (jobId: string) => quotes.filter((q) => q.contractorId === c.id && q.jobId === jobId && q.submittedAt).sort((a, b) => a.submittedAt!.getTime() - b.submittedAt!.getTime())[0];
    const firsts = mine.map((l) => ({ l, q: firstQuote(l.jobId) })).filter((x): x is { l: (typeof mine)[number]; q: NonNullable<ReturnType<typeof firstQuote>> } => !!x.q);
    const done = contractorJobs.filter((j) => j.contractorId === c.id);
    return {
      id: c.id, name: c.name, requests: mine.length, quoted: firsts.length,
      won: quotes.filter((q) => q.contractorId === c.id && q.status === "APPROVED").length,
      avgResponseHours: avg(firsts.map((x) => hours(x.l.createdAt, x.q.submittedAt!))),
      avgDaysToComplete: avg(done.filter((j) => j.assignedAt && j.completedAt).map((j) => hours(j.assignedAt!, j.completedAt!) / 24)),
      reopened: done.filter((j) => j.reopenCount > 0).length,
      spendCents: done.reduce((t, j) => t + (j.approvedCostCents ?? 0), 0), jobsCompleted: done.length,
    };
  }).sort((a, b) => b.spendCents - a.spendCents);
  const techs = await prisma.user.findMany({ where: { id: { in: open.map((o) => o.leadTechnicianId!) } }, select: { id: true, name: true } });
  const sorted = (m: Map<string, number>) => [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  return {
    jobsOpened: opened.length,
    jobsCompleted: closed.length,
    avgHoursToAssignment: avg(opened.filter((j) => j.assignedAt).map((j) => hours(j.reportedAt, j.assignedAt!))),
    avgHoursToCompletion: avg(opened.filter((j) => j.completedAt).map((j) => hours(j.reportedAt, j.completedAt!))),
    respondedOnTime: { onTime, late, pct: onTime + late ? Math.round((onTime / (onTime + late)) * 100) : null },
    overdueJobs,
    awaitingApproval: { count: pending.length, totalCents: pendingQuotes.reduce((t, q) => t + q.totalCents, 0) },
    approvalTurnaroundHours: avg(approved.filter((q) => q.submittedAt && q.decidedAt).map((q) => hours(q.submittedAt!, q.decidedAt!))),
    spendCents: contractorJobs.reduce((t, j) => t + (j.approvedCostCents ?? 0), 0),
    routeSplit: { inHouse: inHouseJobs.length, contractor: contractorJobs.length },
    spendBySite: sorted(spendBySite),
    spendByAsset: sorted(spendByAsset).slice(0, 10),
    contractorPerformance: performance,
    workload: open.map((o) => ({ name: techs.find((t) => t.id === o.leadTechnicianId)?.name ?? "Unknown", openJobs: o._count })).sort((a, b) => b.openJobs - a.openJobs),
    byLocation: sorted(byLocation).map((x) => ({ label: x.label, count: x.value })),
    reopened: { count: reopenedCount, pct: closed.length ? Math.round((reopenedCount / closed.length) * 100) : null },
    inHouseCosts: inHouseJobs.map((j) => ({
      id: j.id, reference: j.reference, title: j.title,
      materialCents: j.updates.reduce((a, u) => a + u.materialCostCents, 0),
      labourHours: Math.round((j.updates.reduce((a, u) => a + u.labourMinutes, 0) / 60) * 10) / 10,
    })),
  };
}
