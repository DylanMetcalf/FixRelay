import { redirect } from "next/navigation";
import { enterSupportAction, setSubscriptionAction } from "@/app/actions/admin";
import { logoutAction } from "@/app/actions/auth";
import { getSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { fmtDate } from "@/components/ui";
import { prisma } from "@/lib/db";
import { subscriptionState } from "@/server/services/billing";
import { listTenants } from "@/server/services/orgs";

export const metadata = { title: "Platform console" };
export const dynamic = "force-dynamic";

/** SaaS operator console: account and subscription metadata only. No tenant business data is shown here. */
export default async function Platform() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.user.isPlatformAdmin) redirect("/forbidden");
  const [tenants, plans, grants] = await Promise.all([
    listTenants(s.user), prisma.plan.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.supportAccessGrant.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { orgId: true } }),
  ]);
  const d = (x: Date | null | undefined) => x?.toISOString().slice(0, 10) ?? "";
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-extrabold">Platform console</h1><p className="muted">Signed in as {s.user.email}. Company data is not visible here.</p></div>
        <form action={logoutAction}><button className="btn btn-secondary">Sign out</button></form>
      </div>
      <ul className="space-y-3">
        {tenants.map((t) => {
          const st = subscriptionState(t.subscription);
          const granted = grants.some((g) => g.orgId === t.id);
          return (
            <li key={t.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{t.name} <span className="text-xs font-semibold text-gray-600">· joined {fmtDate(t.createdAt)}</span></p>
                <p className="text-sm"><strong>{st.planName}</strong> · {st.status} · access: {st.access}{st.endsAt && ` · until ${fmtDate(st.endsAt)}`}</p>
              </div>
              <Form action={setSubscriptionAction} hidden={{ orgId: t.id }} className="mt-3 grid grid-cols-2 items-end gap-2 md:grid-cols-6">
                <label className="text-xs font-bold">Plan<select name="planCode" defaultValue={t.subscription?.plan.code} className="input !min-h-9 text-sm">{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
                <label className="text-xs font-bold">Status<select name="status" defaultValue={t.subscription?.status} className="input !min-h-9 text-sm">{["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="text-xs font-bold">Trial ends<input type="date" name="trialEndsAt" defaultValue={d(t.subscription?.trialEndsAt)} className="input !min-h-9 text-sm" /></label>
                <label className="text-xs font-bold">Period ends<input type="date" name="currentPeriodEnd" defaultValue={d(t.subscription?.currentPeriodEnd)} className="input !min-h-9 text-sm" /></label>
                <label className="text-xs font-bold">Grace ends<input type="date" name="graceEndsAt" defaultValue={d(t.subscription?.graceEndsAt)} className="input !min-h-9 text-sm" /></label>
                <Submit className="btn btn-primary btn-sm">Save</Submit>
              </Form>
              <div className="mt-2">
                {granted
                  ? <Form action={enterSupportAction} hidden={{ orgId: t.id }}><Submit className="btn btn-secondary btn-sm">Open read-only support session (audited)</Submit></Form>
                  : <p className="text-xs text-gray-600">No support access granted by this company.</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
