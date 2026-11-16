import Link from "next/link";
import { createDemoAction } from "@/app/actions/auth";
import { requireSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Card, Empty, JobList, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { can } from "@/server/permissions";
import { listClients } from "@/server/services/clients";
import { dashboardCounts, type JobFilters, listJobs } from "@/server/services/jobs";
import { listAssignable } from "@/server/services/orgs";
import { STATUS_LABEL } from "@/server/workflow";
import { JobFilterBar } from "../jobs/filters";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<JobFilters> }) {
  const s = await requireSession();
  const { ctx } = s;
  const f = await searchParams;
  const manager = can(ctx, "job.viewAll");
  const [counts, jobs, clients, techs] = await Promise.all([
    dashboardCounts(ctx, f),
    listJobs(ctx, { ...f, view: f.status || f.overdue ? "all" : undefined }, 25),
    manager ? listClients(ctx) : [],
    manager ? listAssignable(ctx) : [],
  ]);
  const tiles: { label: string; n: number; href: string; alert?: boolean }[] = [
    { label: "New requests", n: counts.newRequests, href: "?status=NEW" },
    { label: "Awaiting assessment", n: counts.awaitingAssessment, href: "?status=ASSESSING" },
    { label: "Assessed – decision needed", n: counts.assessed, href: "?status=ASSESSED" },
    { label: "Quotes being prepared", n: counts.quoting, href: "?status=QUOTING" },
    { label: "Quotes awaiting approval", n: counts.awaitingApproval, href: "?status=AWAITING_APPROVAL" },
    { label: "Approved – awaiting assignment", n: counts.awaitingAssignment, href: "?status=APPROVED" },
    { label: "Assigned", n: counts.assigned, href: "?status=ASSIGNED" },
    { label: "In progress", n: counts.inProgress, href: "?status=IN_PROGRESS" },
    { label: "On hold", n: counts.onHold, href: "?status=ON_HOLD" },
    { label: "Awaiting verification", n: counts.awaitingVerification, href: "?status=AWAITING_VERIFICATION" },
    { label: "Verified – ready to close", n: counts.readyToClose, href: "?status=VERIFIED" },
    { label: "Overdue", n: counts.overdue, href: "?overdue=true", alert: true },
  ];
  const setup = can(ctx, "org.manage") && !s.org.isDemo ? await onboarding(ctx.orgId) : null;
  return (
    <>
      <PageHeader title="Dashboard" subtitle={manager ? "Every number below is a live count of jobs. Tap one to see them." : "Jobs you are involved in."}>
        <Link href="/requests/new" className="btn btn-primary">+ New request</Link>
      </PageHeader>

      {setup && setup.some((x) => !x.done) && (
        <Card title="Getting started" className="mb-5">
          <ol className="space-y-2">
            {setup.map((x) => (
              <li key={x.label} className="flex items-center gap-3 text-sm">
                <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${x.done ? "bg-green-700 text-white" : "border-2 border-gray-400"}`}>{x.done ? "✓" : ""}</span>
                {x.done ? <span className="text-gray-600 line-through">{x.label}</span> : <Link className="link" href={x.href}>{x.label}</Link>}
              </li>
            ))}
          </ol>
          {!s.workspaces.some((w) => w.isDemo) && (
            <div className="mt-4 border-t border-gray-200 pt-3">
              <p className="muted mb-2">Want to look around first? Create a separate demo workspace with sample jobs. It never mixes with your real data.</p>
              <Form action={createDemoAction}><Submit className="btn btn-secondary">Explore a demo workspace</Submit></Form>
            </div>
          )}
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={`/dashboard${t.href}`} className={`card !p-3 hover:border-gray-500 ${t.alert && t.n > 0 ? "!border-red-400 !bg-red-50" : ""}`}>
            <p className={`text-3xl font-extrabold tabular-nums ${t.alert && t.n > 0 ? "text-red-800" : "text-gray-900"}`}>{t.n}</p>
            <p className="text-xs font-bold text-gray-700">{t.label}</p>
          </Link>
        ))}
      </div>
      <p className="muted mb-4">{counts.unowned} new request{counts.unowned === 1 ? "" : "s"} with no responsible manager yet · {counts.recentlyClosed} closed in the last 7 days.</p>

      {manager && <JobFilterBar base="/dashboard" f={f} clients={clients.map((c) => ({ value: c.id, label: c.name }))} techs={techs.map((t) => ({ value: t.userId, label: t.user.name }))} />}
      <h2 className="mb-3 mt-5 text-lg font-extrabold">{f.status ? STATUS_LABEL[f.status] ?? "Jobs" : f.overdue ? "Overdue jobs" : "Latest activity"}</h2>
      <JobList jobs={jobs} empty={<Empty title="Nothing here">No jobs match. <Link className="link" href="/requests/new">Log a maintenance request</Link>.</Empty>} />
    </>
  );
}

/** Onboarding checklist computed from real records (nothing is "ticked" by hand). */
async function onboarding(orgId: string) {
  const [org, members, invites, clients, sites, jobs] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.membership.count({ where: { orgId } }), prisma.invitation.count({ where: { orgId } }),
    prisma.client.count({ where: { orgId } }), prisma.site.count({ where: { orgId } }), prisma.job.count({ where: { orgId } }),
  ]);
  return [
    { label: "Add your business details and branding", href: "/settings", done: !!org.address || !!org.phone || !!org.logoAttachmentId },
    { label: "Invite your team", href: "/settings#team", done: members + invites > 1 },
    { label: "Add your first customer", href: "/customers", done: clients > 0 },
    { label: "Add a customer site", href: "/customers", done: sites > 0 },
    { label: "Log your first maintenance request", href: "/requests/new", done: jobs > 0 },
  ];
}
