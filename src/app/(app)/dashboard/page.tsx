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
import { dashboardCounts, type JobFilters, type JobRow, listJobs } from "@/server/services/jobs";
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
    listJobs(ctx, { ...f, view: f.status || f.stage || f.overdue || f.source || f.spares || f.duplicates || f.reopened || f.unassigned || f.mode || f.signoff ? "all" : undefined, tab: f.status ? undefined : "open" }, Object.keys(f).length ? 50 : 8),
    manager ? listSites(ctx) : [],
    manager ? listAssignable(ctx) : [],
    manager ? prisma.department.findMany({ where: { orgId: ctx.orgId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
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
      <PageHeader title={manager ? "Dashboard" : `Hello, ${s.user.name.split(" ")[0]}`} subtitle={manager ? "What needs you now, and where every job is. Tap anything to see those jobs." : "Report faults and follow them until they are fixed."}>
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

      {manager && <ManagerOverview counts={counts} f={f} jobs={jobs}
        filters={<JobFilterBar base="/dashboard" f={f} departments={departments.map((d) => ({ value: d.id, label: d.name }))} sites={sites.map((c) => ({ value: c.id, label: c.name }))} techs={techs.map((t) => ({ value: t.userId, label: t.user.name }))} />} />}
    </>
  );
}

type Counts = Awaited<ReturnType<typeof dashboardCounts>>;

/**
 * The manager's overview, kept deliberately simple: (1) the few things that need someone now, (2) one line showing
 * how many jobs are at each of the five stages, (3) the list. Everything else is one tap away on the jobs board.
 */
function ManagerOverview({ counts, f, jobs, filters }: { counts: Counts; f: JobFilters; jobs: JobRow[]; filters: React.ReactNode }) {
  const attention = [
    { label: "Unassigned – nobody responsible", hint: "Give each one an owner", n: counts.unassigned, href: "?unassigned=true" },
    { label: "Public reports to screen", hint: "Reported with a QR code, without an account", n: counts.toScreen, href: "?source=PUBLIC_LINK&status=NEW" },
    { label: "Possible duplicates to review", hint: "Merge them or keep them separate", n: counts.duplicates, href: "?duplicates=flagged" },
    { label: "Overdue", hint: "Past their due date", n: counts.overdue, href: "?overdue=true" },
    { label: "One-person jobs to sign off", hint: "Finished by one person, waiting for a manager", n: counts.selfSignoff, href: "?signoff=true" },
  ].filter((a) => a.n > 0);
  const extras = [
    { label: "one-person jobs in progress", n: counts.selfOpen, href: "?mode=self&status=IN_PROGRESS" },
    { label: "waiting for spares", n: counts.sparesWaiting, href: "?spares=waiting" },
    { label: "reopened", n: counts.reopened, href: "?reopened=true" },
    { label: "finished in the last 7 days", n: counts.recentlyClosed, href: "/jobs?tab=history" },
  ];
  const stage = counts.stages.find((x) => x.key === f.stage);
  const filtered = !!(f.status || f.stage || f.overdue || f.source || f.spares || f.duplicates || f.reopened || f.unassigned || f.mode || f.signoff || f.q || f.siteId || f.departmentId || f.technicianId || f.from || f.to);
  const title = stage ? stage.label : f.status ? STATUS_LABEL[f.status] ?? "Jobs" : f.overdue ? "Overdue jobs" : f.spares ? "Waiting for spares" : f.duplicates ? "Possible duplicates" : f.reopened ? "Reopened work" : f.unassigned ? "Unassigned jobs" : f.signoff ? "One-person jobs to sign off" : f.source ? "Public reports to screen" : f.mode === "self" ? "One-person jobs" : filtered ? "Matching jobs" : "Most urgent open jobs";
  const href = (h: string) => (h.startsWith("/") ? h : `/dashboard${h}`);
  return (
    <>
      <section className="mb-6" data-tour="attention" data-testid="attention">
        <h2 className="mb-2 text-lg font-extrabold">Needs attention</h2>
        {attention.length === 0
          ? <p className="card !border-green-300 !bg-green-50 font-semibold text-green-900">All clear – nothing is waiting on a manager right now.</p>
          : <ul className="space-y-2">{attention.map((a) => (
              <li key={a.label}>
                <Link href={href(a.href)} className="card flex items-center gap-4 !border-red-300 !bg-red-50 !p-3 hover:!border-red-500">
                  <span className="w-10 text-center text-3xl font-extrabold tabular-nums text-red-800">{a.n}</span>
                  <span className="flex-1"><span className="block font-bold text-gray-900">{a.label}</span><span className="text-sm text-gray-700">{a.hint}</span></span>
                  <span aria-hidden className="font-bold text-red-800">View →</span>
                </Link>
              </li>
            ))}</ul>}
      </section>

      <section className="mb-6" data-tour="tiles" data-testid="stages">
        <h2 className="mb-1 text-lg font-extrabold">Where every open job is</h2>
        <p className="muted mb-3">Jobs move through these five stages in order. Tap a stage to see its jobs.</p>
        <ol className="grid gap-2 md:grid-cols-5">
          {counts.stages.map((st, i) => (
            <li key={st.key} className="relative">
              <Link href={`/dashboard?stage=${st.key}`} aria-current={f.stage === st.key ? "true" : undefined}
                className={`card flex h-full items-center gap-3 !p-3 md:flex-col md:items-start md:gap-1 hover:border-gray-500 ${f.stage === st.key ? "!border-blue-700 ring-2 ring-blue-700" : ""}`}>
                <span className="flex items-center gap-2 md:w-full">
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
                  <span className="text-3xl font-extrabold tabular-nums text-gray-900 md:ml-auto">{st.n}</span>
                </span>
                <span><span className="block font-bold text-gray-900">{st.label}</span><span className="text-xs text-gray-700">{st.hint}</span></span>
              </Link>
              {i < counts.stages.length - 1 && <span aria-hidden className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-lg font-bold text-gray-400 md:block">›</span>}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-gray-700">
          {extras.map((x, i) => <span key={x.label}>{i > 0 && " · "}<Link className="link" href={href(x.href)}><strong className="tabular-nums">{x.n}</strong> {x.label}</Link></span>)}
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">{title}</h2>
          {filtered ? <Link className="link text-sm font-semibold" href="/dashboard">← Back to the overview</Link> : <Link className="link text-sm font-semibold" href="/jobs">See all jobs →</Link>}
        </div>
        <details className="mb-3">
          <summary className="cursor-pointer text-sm font-semibold text-blue-800">Search and filter</summary>
          <div className="mt-2">{filters}</div>
        </details>
        <JobList jobs={jobs} empty={<Empty title="Nothing here">No jobs match. <Link className="link" href="/requests/new">Report a fault</Link>.</Empty>} />
      </section>
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
