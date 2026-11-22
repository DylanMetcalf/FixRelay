import { redirect } from "next/navigation";
import { createCustomerAction, enterSupportAction, setSubscriptionAction } from "@/app/actions/admin";
import { getSession } from "@/app/_lib/session";
import { LinkForm } from "@/components/client-forms";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Logo } from "@/components/logo";
import { Card, Check, Field, fmtDate, fmtDateTime, Pill } from "@/components/ui";
import { prisma } from "@/lib/db";
import { subscriptionState } from "@/server/services/billing";
import { platformHealth, platformOverview } from "@/server/services/platform";

export const metadata = { title: "Platform admin" };
export const dynamic = "force-dynamic";

/**
 * Resultra platform administration: create and configure customer companies, follow onboarding, subscriptions,
 * email delivery and platform errors. Account metadata only – company business data needs the company's grant.
 */
export default async function Platform({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login?next=/platform");
  if (!s.user.isPlatformAdmin) redirect("/forbidden");
  const [tenants, plans, health] = await Promise.all([
    platformOverview(s.user, { q }), prisma.plan.findMany({ where: { active: true }, orderBy: { name: "asc" } }), platformHealth(s.user),
  ]);
  const d = (x: Date | null | undefined) => x?.toISOString().slice(0, 10) ?? "";
  return (
    <div className="min-h-dvh bg-mist">
      <header className="bg-navy px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <span className="flex items-center gap-3"><Logo size={30} /><span className="rounded bg-navy-2 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-signal">Platform admin</span></span>
          <form method="post" action="/api/logout"><button className="btn btn-sm border border-navy-3 text-white">Sign out</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <p className="muted">Signed in as {s.user.email}. You see account details only. A company&apos;s jobs, quotes and photos need a time-limited support grant from that company, and every visit is recorded in its history.</p>
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Create a customer company" className="lg:col-span-2">
            <LinkForm action={createCustomerAction} submit="Create company and invite contact" shareLabel="Invitation sent. You can also share this link with the main contact">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company name" name="companyName" required placeholder="e.g. Spanjaard (Pty) Ltd" />
                <Field label="First site" name="siteName" required placeholder="e.g. Alrode Plant" />
                <Field label="Site address" name="siteAddress" />
                <Field label="Company phone" name="phone" type="tel" />
                <Field label="Main contact – name" name="contactName" required />
                <Field label="Main contact – work email" name="contactEmail" type="email" required />
              </div>
              <Field label="Departments (comma separated)" name="departments" defaultValue="Maintenance, Operations, Management, Finance" />
              <Check name="publicReporting" label="Allow QR reporting without an account" defaultChecked />
              <p className="text-xs text-gray-600">The company starts on a trial. The main contact gets a secure invitation and becomes the site administrator.</p>
            </LinkForm>
          </Card>
          <Card title="Platform health (7 days)">
            <div className="space-y-2 text-sm" data-testid="platform-health">
              <p>Emails sent: <strong>{health.email.SENT ?? 0}</strong> · waiting: <strong>{health.email.PENDING ?? 0}</strong> · failed: <strong className={health.email.FAILED ? "text-red-800" : ""}>{health.email.FAILED ?? 0}</strong></p>
              {health.failed.length > 0 && <ul className="space-y-1 text-xs">{health.failed.slice(0, 5).map((f) => <li key={f.id} className="text-red-900">{fmtDateTime(f.createdAt)} · {f.toEmail}: {f.lastError?.slice(0, 120)}</li>)}</ul>}
              <p className="pt-2 font-bold">Recent server errors</p>
              {health.errors.length === 0 ? <p className="text-gray-600">None recorded.</p> : (
                <ul className="space-y-1 text-xs">{health.errors.slice(0, 8).map((e) => <li key={e.id}><span className="text-gray-600">{fmtDateTime(e.createdAt)} · {e.source}</span><br />{e.message.slice(0, 140)}{e.path && <span className="text-gray-600"> ({e.path})</span>}</li>)}</ul>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-extrabold">Customer companies ({tenants.length}{tenants.length === 50 ? "+" : ""})</h2>
          <form method="get" action="/platform" className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="Find a company" aria-label="Find a company" className="input !min-h-9 text-sm" />
            <button className="btn btn-secondary btn-sm">Search</button>
          </form>
        </div>
        <p className="muted -mt-3 text-xs">Newest first; up to 50 shown. Search to find others.</p>
        <ul className="space-y-3" data-testid="customers">
          {tenants.map((t) => {
            const st = subscriptionState(t.subscription);
            return (
              <li key={t.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-extrabold"><Link href={`/platform/${t.id}`} className="hover:underline">{t.name}</Link> <span className="text-xs font-semibold text-gray-600">· joined {fmtDate(t.createdAt)}</span></p>
                    <p className="text-sm text-gray-700">{t.contact ? <>Contact: {t.contact.name} · {t.contact.email} {!t.contact.joined && <Pill tone="amber">Invitation not accepted</Pill>}</> : "No main contact"}</p>
                    <p className="text-xs text-gray-600">{t.counts.sites} site(s) · {t.counts.users} user(s){t.counts.pending ? ` · ${t.counts.pending} waiting for approval` : ""} · {t.counts.departments} department(s) · {t.counts.jobs} job(s) · email {t.email.sent} sent{t.email.failed ? `, ${t.email.failed} failed` : ""}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p><strong>{st.planName}</strong> · {st.status} · access {st.access}</p>
                    <p className="text-xs text-gray-600">Onboarding {t.onboarded}/{t.steps.length}{t.supportUntil ? ` · support granted until ${fmtDateTime(t.supportUntil)}` : ""}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">{t.steps.map((x) => <Pill key={x.label} tone={x.done ? "green" : "gray"}>{x.done ? "✓ " : ""}{x.label}</Pill>)}</div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-blue-800">Subscription and support</summary>
                  <Form action={setSubscriptionAction} hidden={{ orgId: t.id }} className="mt-3 grid grid-cols-2 items-end gap-2 md:grid-cols-6">
                    <label className="text-xs font-bold">Plan<select name="planCode" defaultValue={t.subscription?.plan.code} className="input !min-h-9 text-sm">{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
                    <label className="text-xs font-bold">Status<select name="status" defaultValue={t.subscription?.status} className="input !min-h-9 text-sm">{["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((x) => <option key={x}>{x}</option>)}</select></label>
                    <label className="text-xs font-bold">Trial ends<input type="date" name="trialEndsAt" defaultValue={d(t.subscription?.trialEndsAt)} className="input !min-h-9 text-sm" /></label>
                    <label className="text-xs font-bold">Period ends<input type="date" name="currentPeriodEnd" defaultValue={d(t.subscription?.currentPeriodEnd)} className="input !min-h-9 text-sm" /></label>
                    <label className="text-xs font-bold">Grace ends<input type="date" name="graceEndsAt" defaultValue={d(t.subscription?.graceEndsAt)} className="input !min-h-9 text-sm" /></label>
                    <Submit className="btn btn-primary btn-sm">Save</Submit>
                  </Form>
                  <div className="mt-2">
                    {t.supportUntil
                      ? <Form action={enterSupportAction} hidden={{ orgId: t.id }}><Submit className="btn btn-secondary btn-sm">Open read-only support session (recorded)</Submit></Form>
                      : <p className="text-xs text-gray-600">No support access granted by this company.</p>}
                  </div>
                </details>
              </li>
            );
          })}
          {tenants.length === 0 && <li className="muted">No customer companies yet.</li>}
        </ul>
      </main>
    </div>
  );
}
