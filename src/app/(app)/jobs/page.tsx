import Link from "@/components/link";
import { requireSession } from "@/app/_lib/session";
import { Empty, JobList, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";
import { listSites } from "@/server/services/sites";
import { type JobFilters, listJobs, priorityCounts } from "@/server/services/jobs";
import { listAssignable } from "@/server/services/orgs";
import { PRIORITY_LABEL, PRIORITY_ORDER } from "@/server/workflow";
import { JobFilterBar } from "./filters";
import { prisma } from "@/lib/db";

export const metadata = { title: "Jobs" };

const CHIP_TONE: Record<string, string> = {
  CRITICAL: "border-red-700 text-red-800", HIGH: "border-orange-600 text-orange-800", NORMAL: "border-blue-700 text-blue-800", LOW: "border-gray-500 text-gray-700",
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<JobFilters> }) {
  const { ctx } = await requireSession();
  const f = await searchParams;
  const tab = f.tab === "history" ? "history" : "open";
  // History covers every closed or cancelled job, whichever list it started in.
  const view = tab === "history" ? "all" : f.view === "requests" ? "requests" : f.view === "jobs" ? "jobs" : "all";
  const filters: JobFilters = { ...f, view, tab };
  const manager = can(ctx, "job.viewAll");
  const [jobs, counts, sites, techs, departments] = await Promise.all([
    listJobs(ctx, filters), priorityCounts(ctx, filters), manager ? listSites(ctx) : [], manager ? listAssignable(ctx) : [],
    prisma.department.findMany({ where: { orgId: ctx.orgId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Links keep the other filters and change one value.
  const href = (change: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...change })) if (v && typeof v === "string") p.set(k, v);
    const q = p.toString();
    return q ? `/jobs?${q}` : "/jobs";
  };
  const viewParam = view === "all" ? undefined : view;
  const tabCls = (on: boolean) => `flex-1 rounded-md px-4 py-2 text-center font-bold sm:flex-none ${on ? "bg-white text-gray-900 shadow" : "text-gray-700 hover:text-gray-900"}`;
  const chipCls = (on: boolean, p?: string) => `inline-flex min-h-10 items-center gap-2 rounded-full border-2 px-3 text-sm font-bold ${on ? "bg-gray-900 !border-gray-900 !text-white" : `bg-white ${p ? CHIP_TONE[p] : "border-gray-400 text-gray-800"}`}`;
  const title = tab === "history" ? "Job history" : view === "requests" ? "Fault reports" : "Jobs";
  const subtitle = tab === "history" ? "Finished and cancelled jobs, newest first." : view === "requests" ? "Faults that are new or being assessed." : "Open work, most urgent first.";

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}>
        <Link href="/requests/new" className="btn btn-primary">+ Report a fault</Link>
      </PageHeader>

      <nav aria-label="Open or history" className="mb-3 flex gap-1 rounded-lg bg-gray-200 p-1 sm:inline-flex" data-testid="job-tabs">
        <Link href={href({ tab: undefined, priority: undefined, status: undefined, view: f.view })} className={tabCls(tab === "open")} aria-current={tab === "open" ? "page" : undefined}>Open now</Link>
        <Link href={href({ tab: "history", priority: undefined, status: undefined, view: undefined })} className={tabCls(tab === "history")} aria-current={tab === "history" ? "page" : undefined}>History</Link>
      </nav>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Priority" data-testid="priority-chips">
        <Link href={href({ priority: undefined })} className={chipCls(!f.priority)} aria-current={!f.priority ? "true" : undefined}>All <span className="tabular-nums">{counts.all}</span></Link>
        {PRIORITY_ORDER.map((p) => (
          <Link key={p} href={href({ priority: p })} className={chipCls(f.priority === p, p)} aria-current={f.priority === p ? "true" : undefined}>
            {PRIORITY_LABEL[p]} <span className="tabular-nums">{counts[p as keyof typeof counts]}</span>
          </Link>
        ))}
      </div>

      <JobFilterBar base="/jobs" departments={departments.map((d) => ({ value: d.id, label: d.name }))} view={viewParam} tab={tab === "history" ? "history" : undefined} f={f} sites={sites.map((c) => ({ value: c.id, label: c.name }))} techs={techs.map((t) => ({ value: t.userId, label: t.user.name }))} />
      <div className="mt-4">
        <JobList jobs={jobs} empty={<Empty title={tab === "history" ? "No finished jobs yet" : view === "requests" ? "No open fault reports" : "No open jobs"}>Try clearing the filters, or <Link className="link" href="/requests/new">report a fault</Link>.</Empty>} />
      </div>
    </>
  );
}
