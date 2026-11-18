import { notFound } from "next/navigation";
import { requirePage } from "@/app/_lib/session";
import Link from "@/components/link";
import { PrintButton } from "@/components/print";
import { Card, fmtDate, PageHeader, Pill } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { areaHistory, getReport, METRIC_DEFINITIONS as DEF } from "@/server/services/reports";
import { ROOT_CAUSE_LABEL, ROUTE_LABEL, STATUS_LABEL } from "@/server/workflow";

export const metadata = { title: "Area report" };

/** One area of a site: what has gone wrong there, how often, why, what it cost, and every requisition. Printable. */
export default async function AreaReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { ctx } = await requirePage("reports.view");
  const a = await areaHistory(ctx, (await params).id);
  if (!a) notFound();
  const sp = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const today = new Date();
  const from = valid(sp.from) ?? new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const to = valid(sp.to) ?? today.toISOString().slice(0, 10);
  const r = await getReport(ctx, { from: new Date(from), to: new Date(new Date(to).getTime() + 86_400_000), siteId: a.location.siteId, locationId: a.location.id });
  const { location: loc, jobs } = a;
  const open = jobs.filter((j) => j.status !== "CLOSED" && j.status !== "CANCELLED");
  const days = (v: number | null) => (v == null ? "—" : v >= 48 ? `${(v / 24).toFixed(1)} days` : `${v} h`);
  const Stat = ({ label, value, testid }: { label: string; value: React.ReactNode; testid?: string }) => (
    <div className="card !p-3" data-testid={testid}><p className="text-2xl font-extrabold tabular-nums">{value}</p><p className="text-xs font-bold text-gray-700">{label}</p></div>
  );
  const maxCause = Math.max(1, ...r.rootCauses.map((c) => c.count));
  return (
    <>
      <PageHeader title={loc.name} subtitle={`Area report · ${loc.site.name}${loc.site.address ? `, ${loc.site.address}` : ""}`}>
        <span className="no-print flex flex-wrap gap-2">
          <Link className="btn btn-primary" href={`/requests/new?site=${loc.siteId}&location=${loc.id}`}>+ Report a fault here</Link>
          <a className="btn btn-secondary" href={`/api/reports/jobs.csv?from=${from}&to=${to}&siteId=${loc.siteId}&locationId=${loc.id}`} download>Download (CSV)</a>
          <PrintButton />
        </span>
      </PageHeader>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link className="link no-print" href={`/sites/${loc.siteId}`}>← {loc.site.name}</Link>
        {loc.foodArea && <Pill tone="amber">Food-handling area</Pill>}
        <span className="text-gray-600">Figures for {fmtDate(new Date(from))} – {fmtDate(new Date(to))}; the history below covers all time.</span>
      </p>
      <form method="get" className="card no-print mb-4 flex flex-wrap items-end gap-3 !p-3">
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn btn-secondary">Apply</button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Faults reported" value={r.jobsOpened} testid="area-reported" />
        <Stat label="Open now" value={open.length} testid="area-open" />
        <Stat label="Closed" value={r.jobsCompleted} />
        <Stat label="Avg. time to fix" value={days(r.avgHoursToCompletion)} />
        <Stat label="Contractor spend" value={formatZar(r.spendCents)} />
        <Stat label="Reopened" value={r.reopened.count} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Why things go wrong here"><p className="muted mb-2">{DEF.rootCauses}</p>
          {r.rootCauses.length === 0 ? <p className="text-sm">No closed jobs with a root cause in this period.</p> : (
            <ul className="space-y-2" data-testid="area-root-causes">{r.rootCauses.map((c) => (
              <li key={c.label} className="text-sm"><div className="flex justify-between"><span>{c.label}</span><strong className="tabular-nums">{c.count}</strong></div>
                <div className="h-2 rounded bg-gray-200"><div className="h-2 rounded" style={{ width: `${(c.count / maxCause) * 100}%`, background: "var(--brand)" }} /></div></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Equipment in this area">
          {loc.assets.length === 0 ? <p className="muted">No equipment recorded here.</p> : (
            <ul className="divide-y divide-gray-200 text-sm">{loc.assets.map((x) => (
              <li key={x.id} className="flex justify-between py-1.5"><Link className="link" href={`/assets/${x.id}`}>{x.reference} – {x.name}</Link><span className="text-gray-700">{x._count.jobs} fault{x._count.jobs === 1 ? "" : "s"}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>

      <Card title={`Requisition history (${jobs.length})`}>
        {jobs.length === 0 ? <p className="muted">Nothing has been reported in this area yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="area-history">
              <thead><tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-600"><th className="py-1 pr-2">No.</th><th className="pr-2">Reported</th><th className="pr-2">Fault</th><th className="pr-2">Status</th><th className="pr-2">Fixed by</th><th className="pr-2">Root cause</th><th className="pr-2 text-right">Cost</th></tr></thead>
              <tbody className="divide-y divide-gray-200">{jobs.map((j) => (
                <tr key={j.id} className="align-top">
                  <td className="whitespace-nowrap py-1.5 pr-2"><Link className="link font-semibold" href={`/jobs/${j.id}/report`}>{j.reference}</Link></td>
                  <td className="whitespace-nowrap pr-2">{fmtDate(j.reportedAt)}</td>
                  <td className="pr-2"><Link className="link" href={`/jobs/${j.id}`}>{j.title}</Link>{j.asset && <span className="text-gray-600"> · {j.asset.reference}</span>}{j.isProject && <> <Pill tone="amber">Project</Pill></>}{j.reopenCount > 0 && <> <Pill tone="red">Reopened ×{j.reopenCount}</Pill></>}</td>
                  <td className="whitespace-nowrap pr-2">{STATUS_LABEL[j.status]}</td>
                  <td className="pr-2">{j.route === "CONTRACTOR" ? (j.contractor?.name ?? "Contractor") : ROUTE_LABEL[j.route]}</td>
                  <td className="pr-2">{(j.completions[0]?.rootCauses ?? []).map((c) => ROOT_CAUSE_LABEL[c]).join(", ") || "—"}</td>
                  <td className="whitespace-nowrap pr-2 text-right tabular-nums">{j.approvedCostCents != null ? formatZar(j.approvedCostCents) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
