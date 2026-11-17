import Link from "@/components/link";
import type { JobFilters } from "@/server/services/jobs";
import { STATUS_LABEL } from "@/server/workflow";

type Opt = { value: string; label: string };

/** GET form: filters live in the URL, so views are shareable and work without JavaScript. */
export function JobFilterBar({ base, f, sites, techs, view }: { base: string; f: JobFilters; sites: Opt[]; techs: Opt[]; view?: string }) {
  const sel = "input !min-h-10 !py-1 text-sm";
  return (
    <form method="get" action={base} className="card no-print grid grid-cols-2 gap-2 !p-3 sm:grid-cols-3 lg:grid-cols-9" aria-label="Filter jobs">
      {view && <input type="hidden" name="view" value={view} />}
      <input name="q" defaultValue={f.q} placeholder="Search ref or title" aria-label="Search" className={`${sel} col-span-2`} />
      <select name="status" defaultValue={f.status ?? ""} aria-label="Status" className={sel}>
        <option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select name="priority" defaultValue={f.priority ?? ""} aria-label="Priority" className={sel}>
        <option value="">Any priority</option>{["LOW", "NORMAL", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
      </select>
      <select name="siteId" defaultValue={f.siteId ?? ""} aria-label="Site" className={sel}>
        <option value="">Any site</option>{sites.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <select name="route" defaultValue={f.route ?? ""} aria-label="Fixed by" className={sel}>
        <option value="">In-house or contractor</option><option value="IN_HOUSE">In-house</option><option value="CONTRACTOR">Contractor</option>
      </select>
      <select name="technicianId" defaultValue={f.technicianId ?? ""} aria-label="Technician" className={sel}>
        <option value="">Any technician</option>{techs.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input type="date" name="from" defaultValue={f.from} aria-label="Reported from" className={sel} />
      <input type="date" name="to" defaultValue={f.to} aria-label="Reported to" className={sel} />
      <div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-9">
        <button className="btn btn-secondary btn-sm">Apply filters</button>
        <Link href={view ? `${base}?view=${view}` : base} className="btn btn-sm underline">Clear</Link>
      </div>
    </form>
  );
}
