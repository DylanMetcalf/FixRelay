import Link from "@/components/link";
import { requireSession } from "@/app/_lib/session";
import { Empty, JobList, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";
import { listSites } from "@/server/services/sites";
import { type JobFilters, listJobs } from "@/server/services/jobs";
import { listAssignable } from "@/server/services/orgs";
import { JobFilterBar } from "./filters";

export const metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<JobFilters> }) {
  const { ctx } = await requireSession();
  const f = await searchParams;
  const view = f.view === "requests" ? "requests" : f.view === "jobs" ? "jobs" : "all";
  const manager = can(ctx, "job.viewAll");
  const [jobs, sites, techs] = await Promise.all([listJobs(ctx, { ...f, view }), manager ? listSites(ctx) : [], manager ? listAssignable(ctx) : []]);
  return (
    <>
      <PageHeader title={view === "requests" ? "Fault reports" : "Jobs"} subtitle={view === "requests" ? "Faults that are new or being assessed." : "Work being quoted, approved, done or finished."}>
        <Link href="/requests/new" className="btn btn-primary">+ Report a fault</Link>
      </PageHeader>
      <JobFilterBar base="/jobs" view={view === "all" ? undefined : view} f={f} sites={sites.map((c) => ({ value: c.id, label: c.name }))} techs={techs.map((t) => ({ value: t.userId, label: t.user.name }))} />
      <div className="mt-4">
        <JobList jobs={jobs} empty={<Empty title={view === "requests" ? "No open fault reports" : "No jobs found"}>Try clearing the filters, or <Link className="link" href="/requests/new">report a fault</Link>.</Empty>} />
      </div>
    </>
  );
}
