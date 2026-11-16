import Link from "next/link";
import { requirePage } from "@/app/_lib/session";
import { Card, PageHeader } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { listClients } from "@/server/services/clients";
import { getReport, METRIC_DEFINITIONS as DEF } from "@/server/services/reports";

export const metadata = { title: "Reports" };

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; clientId?: string }> }) {
  const { ctx } = await requirePage("reports.view");
  const sp = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const today = new Date();
  const from = valid(sp.from) ?? new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = valid(sp.to) ?? today.toISOString().slice(0, 10);
  const clients = await listClients(ctx);
  const clientId = clients.find((c) => c.id === sp.clientId)?.id;
  const r = await getReport(ctx, { from: new Date(from), to: new Date(new Date(to).getTime() + 86_400_000), clientId });
  const h = (v: number | null) => (v == null ? "—" : v >= 48 ? `${(v / 24).toFixed(1)} days` : `${v} h`);
  const Stat = ({ label, value, def }: { label: string; value: React.ReactNode; def: string }) => (
    <div className="card !p-4"><p className="text-3xl font-extrabold tabular-nums">{value}</p><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-gray-600">{def}</p></div>
  );
  return (
    <>
      <PageHeader title="Reports" subtitle="Operational figures calculated directly from your job records. Each figure states exactly how it is counted." />
      <form method="get" className="card no-print mb-5 flex flex-wrap items-end gap-3 !p-3">
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="clientId">Customer</label><select id="clientId" name="clientId" defaultValue={clientId ?? ""} className="input"><option value="">All customers</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn btn-secondary">Apply</button>
      </form>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Jobs opened" value={r.jobsOpened} def={DEF.jobsOpened} />
        <Stat label="Jobs completed" value={r.jobsCompleted} def={DEF.jobsCompleted} />
        <Stat label="Avg. time to assignment" value={h(r.avgHoursToAssignment)} def={DEF.avgHoursToAssignment} />
        <Stat label="Avg. time to completion" value={h(r.avgHoursToCompletion)} def={DEF.avgHoursToCompletion} />
        <Stat label="Outstanding quotes" value={<>{r.outstandingQuotes.count} <span className="text-base font-bold text-gray-600">{formatZar(r.outstandingQuotes.totalCents)}</span></>} def={DEF.outstandingQuotes} />
        <Stat label="Approval turnaround" value={h(r.avgApprovalHours)} def={DEF.avgApprovalHours} />
        <Stat label="Overdue jobs" value={r.overdueJobs} def={DEF.overdueJobs} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Workload by technician"><p className="muted mb-2">{DEF.workload}</p>
          {r.workload.length === 0 ? <p className="text-sm">No open assigned jobs.</p> : <Bars rows={r.workload.map((w) => ({ label: w.name, n: w.openJobs }))} />}
        </Card>
        <Card title="Jobs by customer and site"><p className="muted mb-2">{DEF.byCustomer}</p>
          {r.byCustomer.length === 0 ? <p className="text-sm">No requests in this period.</p> : <Bars rows={r.byCustomer.map((w) => ({ label: w.label, n: w.count }))} />}
        </Card>
      </div>
      <Card title="Quoted versus recorded" className="mt-5"><p className="muted mb-2">{DEF.quotedVsRecorded}</p>
        {r.quotedVsRecorded.length === 0 ? <p className="text-sm">No jobs were closed in this period.</p> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className="th">Job</th><th className="th text-right">Quoted (excl. VAT)</th><th className="th text-right">Materials recorded</th><th className="th text-right">Labour recorded</th></tr></thead>
            <tbody className="divide-y divide-gray-200">{r.quotedVsRecorded.map((j) => (
              <tr key={j.id}><td className="td"><Link className="link" href={`/jobs/${j.id}`}>{j.reference}</Link> {j.title}</td>
                <td className="td text-right tabular-nums">{j.quotedCents == null ? "No quote" : formatZar(j.quotedCents)}</td>
                <td className="td text-right tabular-nums">{formatZar(j.materialCents)}</td><td className="td text-right tabular-nums">{j.labourHours} h</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="space-y-2">{rows.map((r) => (
      <li key={r.label} className="text-sm"><div className="flex justify-between"><span>{r.label}</span><span className="font-bold tabular-nums">{r.n}</span></div>
        <div className="h-2 rounded bg-gray-200"><div className="h-2 rounded" style={{ width: `${(r.n / max) * 100}%`, background: "var(--brand)" }} /></div></li>
    ))}</ul>
  );
}
