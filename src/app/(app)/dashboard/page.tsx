import Link from "@/components/link";
import { createDemoAction } from "@/app/actions/auth";
import { requireSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Card, Empty, JobList, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { can } from "@/server/permissions";
import { listSites } from "@/server/services/sites";
import { formatZar } from "@/lib/money";
import { approvalLimit } from "@/server/permissions";
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
  const [counts, jobs, sites, techs, departments] = await Promise.all([
    dashboardCounts(ctx, f),
    listJobs(ctx, { ...f, view: f.status || f.overdue || f.source || f.spares || f.duplicates || f.reopened || f.unassigned ? "all" : undefined }, 25),
    manager ? listSites(ctx) : [],
    manager ? listAssignable(ctx) : [],
    manager ? prisma.department.findMany({ where: { orgId: ctx.orgId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const tiles: { label: string; n: number; href: string; alert?: boolean }[] = [
    { label: "New fault reports", n: counts.newRequests, href: "?status=NEW" },
    { label: "Unassigned – nobody responsible", n: counts.unassigned, href: "?unassigned=true", alert: true },
    { label: "Possible duplicates to review", n: counts.duplicates, href: "?duplicates=flagged", alert: true },
    { label: "Public reports to screen", n: counts.toScreen, href: "?source=PUBLIC_LINK&status=NEW", alert: true },
    { label: "Awaiting assessment", n: counts.awaitingAssessment, href: "?status=ASSESSING" },
    { label: "Assessed – decide how to fix", n: counts.assessed, href: "?status=ASSESSED" },
    { label: "Getting quotes", n: counts.quoting, href: "?status=QUOTING" },
    { label: "Awaiting spend approval", n: counts.awaitingApproval, href: "?status=AWAITING_APPROVAL" },
    { label: "Approved – assign technician", n: counts.awaitingAssignment, href: "?status=APPROVED" },
    { label: "Assigned (in-house or contractor)", n: counts.assigned, href: "?status=ASSIGNED" },
    { label: "In progress", n: counts.inProgress, href: "?status=IN_PROGRESS" },
    { label: "On hold", n: counts.onHold, href: "?status=ON_HOLD" },
    { label: "Awaiting confirmation it's fixed", n: counts.awaitingVerification, href: "?status=AWAITING_VERIFICATION" },
    { label: "Confirmed – ready to close", n: counts.readyToClose, href: "?status=VERIFIED" },
    { label: "Waiting for spares", n: counts.sparesWaiting, href: "?spares=waiting" },
    { label: "Reopened work", n: counts.reopened, href: "?reopened=true" },
    { label: "Completed in the last 7 days", n: counts.recentlyClosed, href: "/jobs?tab=history" },
    { label: "Overdue", n: counts.overdue, href: "?overdue=true", alert: true },
  ];
  const setup = can(ctx, "org.manage") && !s.org.isDemo ? await onboarding(ctx.orgId, s.user.emailVerified) : null;
  // Things waiting for THIS person: quotes within their approval limit, and their own reports to confirm.
  const rules = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { managerApprovalLimitCents: true, approverApprovalLimitCents: true } });
  const myLimit = approvalLimit(ctx, rules);
  const pending = can(ctx, "spend.approve") ? await prisma.job.findMany({
    where: { orgId: ctx.orgId, status: "AWAITING_APPROVAL", ...(ctx.siteIds.length ? { siteId: { in: ctx.siteIds } } : {}) },
    select: { id: true, reference: true, title: true, recommendedQuoteId: true, site: { select: { name: true } } },
  }) : [];
  const pendingQuotes = pending.length ? await prisma.quote.findMany({ where: { id: { in: pending.map((p) => p.recommendedQuoteId!).filter(Boolean) } }, select: { id: true, totalCents: true, contractor: { select: { name: true } } } }) : [];
  const toApprove = pending.map((j) => ({ ...j, quote: pendingQuotes.find((q) => q.id === j.recommendedQuoteId) })).filter((j) => j.quote && j.quote.totalCents <= myLimit);
  const toConfirm = await prisma.job.findMany({ where: { orgId: ctx.orgId, requesterId: ctx.userId, status: "AWAITING_VERIFICATION", reporterConfirmation: true }, select: { id: true, reference: true, title: true, site: { select: { name: true } } } });
  const managed = ctx.managedDepartmentIds ?? [];
  const deptWork = !manager && managed.length ? (await listJobs(ctx, { view: "all", tab: "open" }, 100)).filter((j) => j.departmentId && managed.includes(j.departmentId)) : [];
  const stores = can(ctx, "spares.manage") && !manager;
  const spares = stores ? await listJobs(ctx, { view: "all", spares: "waiting" }, 100) : [];
  const myReports = !manager ? await listJobs(ctx, { view: "all", reportedByMe: stores || undefined }, 10).then((js) => js.filter((j) => j.status !== "CLOSED" && j.status !== "CANCELLED")) : [];
  return (
    <>
      <PageHeader title={manager ? "Dashboard" : `Hello, ${s.user.name.split(" ")[0]}`} subtitle={manager ? "Every number below is a live count of jobs. Tap one to see them." : "Report faults and follow them until they are fixed."}>
        <Link href="/requests/new" className="btn btn-primary">+ Report a fault</Link>
      </PageHeader>

      {can(ctx, "spend.approve") && toApprove.length > 0 && (
        <Card title="Needs your approval" className="mb-5 !border-l-8 !border-l-signal">
          <ul className="divide-y divide-gray-200" data-testid="needs-approval">
            {toApprove.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="text-xs font-bold text-gray-600">{j.reference} · {j.site.name}</span><span className="block font-semibold">{j.title}</span><span className="text-sm">{j.quote!.contractor?.name} – <strong>{formatZar(j.quote!.totalCents)}</strong></span></span>
                <Link href={`/jobs/${j.id}`} className="btn btn-primary btn-sm">Review</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {toConfirm.length > 0 && (
        <Card title="Is it fixed? Please confirm" className="mb-5 !border-l-8 !border-l-signal">
          <ul className="divide-y divide-gray-200" data-testid="needs-confirmation">
            {toConfirm.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="text-xs font-bold text-gray-600">{j.reference} · {j.site.name}</span><span className="block font-semibold">{j.title}</span></span>
                <Link href={`/jobs/${j.id}`} className="btn btn-primary btn-sm">Confirm</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {managed.length > 0 && !manager && (
        <section className="mb-6" data-testid="department-queue">
          <h2 className="mb-3 text-lg font-extrabold">Your department&apos;s open work <span className="tabular-nums text-gray-600">({deptWork.length})</span></h2>
          <JobList jobs={deptWork} empty={<p className="muted">Nothing open for your department.</p>} />
        </section>
      )}
      {stores && (
        <div className="mb-6 space-y-5" data-testid="stores-queue">
          {([["ON_HAND", "Spares to issue from stores"], ["TO_BUY", "Spares to order"], ["ORDERED", "Ordered – waiting for delivery"]] as const).map(([k, title]) => {
            const list = spares.filter((j) => j.sparesStatus === k);
            return (
              <section key={k}>
                <h2 className="mb-3 text-lg font-extrabold">{title} <span className="tabular-nums text-gray-600">({list.length})</span></h2>
                <JobList jobs={list} empty={<p className="muted">Nothing here.</p>} />
              </section>
            );
          })}
        </div>
      )}
      {!manager && (
        <>
          <h2 className="mb-3 text-lg font-extrabold">Your open reports</h2>
          <JobList jobs={myReports} empty={<Empty title="Nothing open">When you report a fault you can follow it here until it is fixed.</Empty>} />
        </>
      )}

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

      {manager && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map((t) => (
              <Link key={t.label} href={t.href.startsWith("/") ? t.href : `/dashboard${t.href}`} className={`card !p-3 hover:border-gray-500 ${t.alert && t.n > 0 ? "!border-red-400 !bg-red-50" : ""}`}>
                <p className={`text-3xl font-extrabold tabular-nums ${t.alert && t.n > 0 ? "text-red-800" : "text-gray-900"}`}>{t.n}</p>
                <p className="text-xs font-bold text-gray-700">{t.label}</p>
              </Link>
            ))}
          </div>
          <p className="muted mb-4">{counts.unowned} new report{counts.unowned === 1 ? "" : "s"} with no responsible manager yet · {counts.recentlyClosed} closed in the last 7 days.</p>
          <JobFilterBar base="/dashboard" f={f} departments={departments.map((d) => ({ value: d.id, label: d.name }))} sites={sites.map((c) => ({ value: c.id, label: c.name }))} techs={techs.map((t) => ({ value: t.userId, label: t.user.name }))} />
          <h2 className="mb-3 mt-5 text-lg font-extrabold">{f.status ? STATUS_LABEL[f.status] ?? "Jobs" : f.overdue ? "Overdue jobs" : f.spares ? "Waiting for spares" : f.duplicates ? "Possible duplicates" : f.reopened ? "Reopened work" : f.unassigned ? "Unassigned jobs" : "Latest activity"}</h2>
          <JobList jobs={jobs} empty={<Empty title="Nothing here">No jobs match. <Link className="link" href="/requests/new">Report a fault</Link>.</Empty>} />
        </>
      )}
    </>
  );
}

/** Onboarding checklist computed from real records (nothing is "ticked" by hand). */
async function onboarding(orgId: string, emailVerified: boolean) {
  const [org, members, invites, contractors, sites, jobs] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.membership.count({ where: { orgId } }), prisma.invitation.count({ where: { orgId } }),
    prisma.contractor.count({ where: { orgId } }), prisma.site.count({ where: { orgId } }), prisma.job.count({ where: { orgId } }),
  ]);
  return [
    { label: "Confirm your email address (check your inbox)", href: "/profile", done: emailVerified },
    { label: "Add your business details and branding", href: "/settings", done: !!org.address || !!org.phone || !!org.logoAttachmentId },
    { label: "Invite your team", href: "/settings#team", done: members + invites > 1 },
    { label: "Add your first site", href: "/sites", done: sites > 0 },
    { label: "Add a contractor you use", href: "/contractors", done: contractors > 0 },
    { label: "Report your first fault", href: "/requests/new", done: jobs > 0 },
    { label: "Print QR codes for your site", href: "/sites", done: false },
  ];
}
