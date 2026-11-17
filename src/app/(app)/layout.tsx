import Link from "@/components/link";
import { Suspense } from "react";
import { resendVerificationAction, switchWorkspaceAction } from "@/app/actions/auth";
import { requireSession } from "@/app/_lib/session";
import { NavLink } from "@/components/client";
import { Form, Submit } from "@/components/form";
import { readableOn, safeColour } from "@/lib/colour";
import { can } from "@/server/permissions";
import { unreadCount } from "@/server/services/notifications";
import { fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const { ctx, org, subscription: sub } = s;
  const unread = await unreadCount(ctx);
  const brand = safeColour(org.brandColour);
  const manager = can(ctx, "job.viewAll");
  const tech = ctx.roles.includes("TECHNICIAN");
  const home = manager ? "/dashboard" : tech ? "/my-jobs" : "/jobs";
  const nav = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/my-jobs", label: "My jobs", show: tech },
    { href: "/jobs?view=requests", label: "Requests", show: true },
    { href: "/jobs?view=jobs", label: "Jobs", show: true },
    { href: "/quotes", label: "Quotes", show: can(ctx, "quote.view") },
    { href: "/customers", label: "Customers", show: can(ctx, "clients.view") },
    { href: "/assets", label: "Assets", show: can(ctx, "clients.view") },
    { href: "/reports", label: "Reports", show: can(ctx, "reports.view") },
    { href: "/settings", label: "Settings", show: can(ctx, "team.view") },
  ].filter((n) => n.show);
  const side = "block rounded-md px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-navy-2";
  const tab = "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-bold text-slate-300";
  return (
    <div style={{ "--brand": brand, "--brand-fg": readableOn(brand) } as React.CSSProperties} className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
      <aside className="no-print hidden w-60 shrink-0 flex-col bg-navy md:flex">
        <Brand org={org} />
        <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-2">
          <Suspense>{nav.map((n) => <NavLink key={n.href} href={n.href} className={side} activeClass="!bg-[var(--brand)] !text-[var(--brand-fg)]">{n.label}</NavLink>)}</Suspense>
        </nav>
        <div className="border-t border-navy-3 p-3">
          <Link href="/profile" className="block truncate text-sm font-bold text-white">{s.user.name}</Link>
          <p className="truncate text-xs text-slate-400">{ctx.support ? "Platform support (read-only)" : ctx.roles.join(", ").toLowerCase()}</p>
          <form method="post" action="/api/logout"><button className="mt-2 text-xs font-bold text-slate-300 underline">Sign out</button></form>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-20 md:pb-0">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-300 bg-white px-4 py-2">
          <div className="flex min-w-0 items-center gap-2 md:hidden"><Brand org={org} compact /></div>
          <div className="hidden min-w-0 md:block">
            {s.workspaces.length > 1 && (
              <Form action={switchWorkspaceAction} className="flex items-center gap-2">
                <label htmlFor="ws" className="sr-only">Workspace</label>
                <select id="ws" name="orgId" defaultValue={org.id} className="input !min-h-9 !py-1 text-sm">
                  {s.workspaces.map((w) => <option key={w.orgId} value={w.orgId}>{w.name}</option>)}
                </select>
                <Submit className="btn btn-secondary btn-sm">Switch</Submit>
              </Form>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/requests/new" className="btn btn-primary btn-sm hidden md:inline-flex">+ New request</Link>
            <Link href="/notifications" className="btn btn-secondary btn-sm relative" aria-label={`Notifications, ${unread} unread`}>
              Alerts{unread > 0 && <span className="ml-1 rounded-full bg-red-700 px-1.5 text-[11px] text-white" data-testid="unread">{unread}</span>}
            </Link>
          </div>
        </header>

        {!s.user.emailVerified && !ctx.support && (
          <Banner tone="blue">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><strong>Please confirm your email address.</strong> We sent a link to {s.user.email}. You need it to invite people and send quotes.</span>
              <Form action={resendVerificationAction} className="inline-flex items-center gap-2"><Submit className="btn btn-secondary btn-sm">Resend link</Submit></Form>
            </div>
          </Banner>
        )}
        {org.isDemo && <Banner tone="amber"><strong>Demo workspace.</strong> This is sample data, kept completely separate from your company. Switch workspace from your profile.</Banner>}
        {ctx.support && <Banner tone="red"><strong>Support session (read-only).</strong> You are viewing {org.name} under a time-limited grant. This visit is recorded in their audit trail.</Banner>}
        {sub?.access === "grace" && <Banner tone="amber"><strong>{sub.message}</strong> Full access continues until {fmtDate(sub.endsAt)}.</Banner>}
        {sub?.access === "locked" && !ctx.support && <Banner tone="red"><strong>Read-only: {sub.message}</strong> You can still view and export all your records. Contact us to reactivate.</Banner>}
        {sub?.status === "TRIALING" && sub.access === "full" && can(ctx, "org.manage") && <Banner tone="blue">Free trial until {fmtDate(sub.endsAt)}.</Banner>}

        <main id="main" className="mx-auto max-w-6xl px-4 py-5 sm:px-6">{children}</main>
      </div>

      <nav aria-label="Mobile" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-navy-3 bg-navy pb-[env(safe-area-inset-bottom)] md:hidden">
        <Suspense>
          <NavLink href={home} className={tab} activeClass="!text-signal"><Icon d="M3 12l9-9 9 9M5 10v10h14V10" />{manager ? "Dashboard" : tech ? "My jobs" : "Jobs"}</NavLink>
          <NavLink href="/requests/new" className={tab} activeClass="!text-signal"><Icon d="M12 5v14M5 12h14" />New request</NavLink>
          <NavLink href="/notifications" className={tab} activeClass="!text-signal"><Icon d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0" />Alerts{unread > 0 ? ` (${unread})` : ""}</NavLink>
          <NavLink href="/profile" className={tab} activeClass="!text-signal"><Icon d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" />Profile</NavLink>
        </Suspense>
      </nav>
    </div>
  );
}

function Brand({ org, compact }: { org: { name: string; logoAttachmentId: string | null }; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${compact ? "" : "px-4 py-4"}`}>
      {org.logoAttachmentId
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`/api/files/${org.logoAttachmentId}`} alt="" className="h-9 w-9 shrink-0 rounded bg-white object-contain" />
        : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-base font-extrabold" style={{ background: "var(--brand)", color: "var(--brand-fg)" }}>{org.name[0]?.toUpperCase()}</span>}
      <span className={`truncate text-sm font-extrabold ${compact ? "text-gray-900" : "text-white"}`}>{org.name}</span>
    </div>
  );
}

function Banner({ tone, children }: { tone: "amber" | "red" | "blue"; children: React.ReactNode }) {
  const c = { amber: "bg-amber-100 text-amber-950 border-amber-300", red: "bg-red-100 text-red-950 border-red-300", blue: "bg-blue-50 text-blue-950 border-blue-200" }[tone];
  return <div role="status" className={`no-print border-b px-4 py-2 text-sm ${c}`}>{children}</div>;
}

const Icon = ({ d }: { d: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
