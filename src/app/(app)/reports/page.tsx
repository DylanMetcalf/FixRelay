import { requirePage } from "@/app/_lib/session";
import Link from "@/components/link";
import { Card, PageHeader } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { prisma } from "@/lib/db";
import { getReport, METRIC_DEFINITIONS as DEF } from "@/server/services/reports";
import { listSites } from "@/server/services/sites";

export const metadata = { title: "Insights" };

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; siteId?: string; locationId?: string }> }) {
  const { ctx } = await requirePage("reports.view");
  const sp = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const today = new Date();
  const from = valid(sp.from) ?? new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = valid(sp.to) ?? today.toISOString().slice(0, 10);
  const sites = await listSites(ctx);
  const siteId = sites.find((c) => c.id === sp.siteId)?.id;
  const areas = await prisma.location.findMany({ where: { orgId: ctx.orgId, siteId: { in: sites.map((x) => x.id) } }, select: { id: true, name: true, siteId: true }, orderBy: { name: "asc" } });
  const area = areas.find((l) => l.id === sp.locationId && (!siteId || l.siteId === siteId));
  const locationId = area?.id;
  const r = await getReport(ctx, { from: new Date(from), to: new Date(new Date(to).getTime() + 86_400_000), siteId: siteId ?? area?.siteId, locationId });
  const csv = `/api/reports/jobs.csv?from=${from}&to=${to}${siteId ? `&siteId=${siteId}` : ""}${locationId ? `&locationId=${locationId}` : ""}`;
  const h = (v: number | null) => (v == null ? "—" : v >= 48 ? `${(v / 24).toFixed(1)} days` : `${v} h`);
  const Stat = ({ label, value, def }: { label: string; value: React.ReactNode; def: string }) => (
    <div className="card !p-4"><p className="text-3xl font-extrabold tabular-nums">{value}</p><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-gray-600">{def}</p></div>
  );
  return (
    <>
      <PageHeader title="Insights" subtitle="Figures calculated directly from your job records. Each one states exactly how it is counted.">
        {area && <Link className="btn btn-secondary" href={`/areas/${area.id}`}>Area report</Link>}
        <a className="btn btn-secondary" href={csv} download>Download jobs (CSV)</a>
      </PageHeader>
      <form method="get" className="card no-print mb-5 flex flex-wrap items-end gap-3 !p-3">
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="siteId">Site</label><select id="siteId" name="siteId" defaultValue={siteId ?? ""} className="input"><option value="">All sites</option>{sites.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="locationId">Area</label><select id="locationId" name="locationId" defaultValue={locationId ?? ""} className="input"><option value="">All areas</option>
          {sites.map((st) => { const ls = areas.filter((l) => l.siteId === st.id); return ls.length ? <optgroup key={st.id} label={st.name}>{ls.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup> : null; })}</select></div>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Faults reported" value={r.jobsOpened} def={DEF.jobsOpened} />
        <Stat label="Jobs closed" value={r.jobsCompleted} def={DEF.jobsCompleted} />
        <Stat label="Contractor spend" value={formatZar(r.spendCents)} def={DEF.spend} />
        <Stat label="In-house vs contractor" value={`${r.routeSplit.inHouse} / ${r.routeSplit.contractor}`} def={DEF.routeSplit} />
        <Stat label="Responded on time" value={r.respondedOnTime.pct == null ? "—" : `${r.respondedOnTime.pct}%`} def={`${r.respondedOnTime.onTime} on time, ${r.respondedOnTime.late} late. ${DEF.respondedOnTime}`} />
        <Stat label="Avg. time to assign" value={h(r.avgHoursToAssignment)} def={DEF.avgHoursToAssignment} />
        <Stat label="Avg. time to fix" value={h(r.avgHoursToCompletion)} def={DEF.avgHoursToCompletion} />
        <Stat label="Overdue jobs" value={r.overdueJobs} def={DEF.overdueJobs} />
        <Stat label="Awaiting spend approval" value={<>{r.awaitingApproval.count} <span className="text-base font-bold text-gray-600">{formatZar(r.awaitingApproval.totalCents)}</span></>} def={DEF.awaitingApproval} />
        <Stat label="Approval turnaround" value={h(r.approvalTurnaroundHours)} def={DEF.approvalTurnaround} />
        <Stat label="Reopened jobs" value={r.reopened.count} def={`${r.reopened.pct == null ? "" : `${r.reopened.pct}% of closed. `}${DEF.reopened}`} />
      </div>

      <Card title="Contractor performance" className="mt-5"><p className="muted mb-2">{DEF.contractorPerformance}</p>
        {r.contractorPerformance.length === 0 ? <p className="text-sm">No contractor activity in this period.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="contractor-performance">
            <thead><tr><th className="th">Contractor</th><th className="th text-right">Asked</th><th className="th text-right">Quoted</th><th className="th text-right">Won</th><th className="th text-right">Response</th><th className="th text-right">Days to fix</th><th className="th text-right">Reopened</th><th className="th text-right">Spend</th></tr></thead>
            <tbody className="divide-y divide-gray-200">{r.contractorPerformance.map((c) => (
              <tr key={c.id}><td className="td"><Link className="link" href={`/contractors/${c.id}`}>{c.name}</Link></td><td className="td text-right">{c.requests}</td><td className="td text-right">{c.quoted}</td><td className="td text-right">{c.won}</td>
                <td className="td text-right">{h(c.avgResponseHours)}</td><td className="td text-right">{c.avgDaysToComplete ?? "—"}</td><td className="td text-right">{c.reopened}</td><td className="td text-right tabular-nums">{formatZar(c.spendCents)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Spend by site"><p className="muted mb-2">{DEF.spendBySite}</p>
          {r.spendBySite.length === 0 ? <p className="text-sm">No contractor spend in this period.</p> : <Bars rows={r.spendBySite.map((x) => ({ label: x.label, n: x.value, text: formatZar(x.value) }))} />}
        </Card>
        <Card title="Spend by equipment"><p className="muted mb-2">{DEF.spendByAsset}</p>
          {r.spendByAsset.length === 0 ? <p className="text-sm">No equipment spend in this period.</p> : <Bars rows={r.spendByAsset.map((x) => ({ label: x.label, n: x.value, text: formatZar(x.value) }))} />}
        </Card>
        <Card title="Root causes"><p className="muted mb-2">{DEF.rootCauses}</p>
          {r.rootCauses.length === 0 ? <p className="text-sm">No closed jobs with a root cause in this period.</p> : <Bars rows={r.rootCauses.map((w) => ({ label: w.label, n: w.count }))} />}
        </Card>
        <Card title="Most affected areas"><p className="muted mb-2">{DEF.byLocation} Open an area for its full history and report.</p>
          {r.byLocation.length === 0 ? <p className="text-sm">No faults in this period.</p> : <div data-testid="affected-areas"><Bars rows={r.byLocation.map((w) => ({ label: w.label, n: w.count, text: `${w.count} reported${w.open ? ` · ${w.open} open` : ""}`, href: w.locationId ? `/areas/${w.locationId}` : undefined }))} /></div>}
        </Card>
        <Card title="In-house workload"><p className="muted mb-2">{DEF.workload}</p>
          {r.workload.length === 0 ? <p className="text-sm">No open in-house jobs.</p> : <Bars rows={r.workload.map((w) => ({ label: w.name, n: w.openJobs }))} />}
        </Card>
      </div>
      <Card title="In-house labour and materials" className="mt-5"><p className="muted mb-2">{DEF.inHouseCosts}</p>
        {r.inHouseCosts.length === 0 ? <p className="text-sm">No in-house jobs were closed in this period.</p> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className="th">Job</th><th className="th text-right">Materials</th><th className="th text-right">Labour</th></tr></thead>
            <tbody className="divide-y divide-gray-200">{r.inHouseCosts.map((j) => (
              <tr key={j.id}><td className="td"><Link className="link" href={`/jobs/${j.id}`}>{j.reference}</Link> {j.title}</td><td className="td text-right tabular-nums">{formatZar(j.materialCents)}</td><td className="td text-right tabular-nums">{j.labourHours} h</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

function Bars({ rows }: { rows: { label: string; n: number; text?: string; href?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="space-y-2">{rows.map((r) => (
      <li key={r.label} className="text-sm"><div className="flex justify-between gap-2">{r.href ? <Link className="link" href={r.href}>{r.label}</Link> : <span>{r.label}</span>}<span className="font-bold tabular-nums">{r.text ?? r.n}</span></div>
        <div className="h-2 rounded bg-gray-200"><div className="h-2 rounded" style={{ width: `${(r.n / max) * 100}%`, background: "var(--brand)" }} /></div></li>
    ))}</ul>
  );
}
