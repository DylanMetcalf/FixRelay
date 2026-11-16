import * as a from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { LinkForm } from "@/components/client-forms";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, Check, Field, fmtDate, fmtDateTime, PageHeader, Pill, TextArea } from "@/components/ui";
import { prisma } from "@/lib/db";
import { can } from "@/server/permissions";
import { usage } from "@/server/services/billing";
import { listSupportGrants, listTeam } from "@/server/services/orgs";

export const metadata = { title: "Settings" };
const STAFF_ROLES = [["OWNER", "Owner / administrator"], ["MANAGER", "Manager / dispatcher"], ["TECHNICIAN", "Technician"]] as const;

export default async function Settings() {
  const { ctx, subscription: sub } = await requirePage("team.view");
  const owner = can(ctx, "org.manage");
  const [org, team, rules, grants, used] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { subscription: { include: { plan: true } } } }),
    listTeam(ctx), prisma.priorityRule.findMany({ where: { orgId: ctx.orgId } }), owner ? listSupportGrants(ctx) : [], usage(prisma, ctx.orgId),
  ]);
  const plan = org.subscription?.plan;
  const lim = (n: number | null | undefined) => (n == null ? "unlimited" : n);
  return (
    <>
      <PageHeader title="Settings" subtitle={owner ? "Company details, team and subscription." : "Your team. Only owners can change company settings."} />
      <div className="grid gap-5 lg:grid-cols-2">
        {owner && (
          <Card title="Company and branding">
            <Form action={a.saveSettingsAction}>
              <Field label="Company display name" name="name" required defaultValue={org.name} />
              <Field label="Address" name="address" defaultValue={org.address} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" name="phone" defaultValue={org.phone} />
                <Field label="Contact email" name="contactEmail" type="email" defaultValue={org.contactEmail} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Brand colour" name="brandColour" type="color" defaultValue={org.brandColour} hint="Used for buttons and your customer pages." />
                <Field label="Logo" name="logo" hint="PNG, JPEG or WebP, up to 1 MB. Also used as the app icon."><input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="input" /></Field>
              </div>
              <fieldset className="rounded-md border border-gray-300 p-3">
                <legend className="px-1 text-sm font-bold">Tax</legend>
                <Check name="vatRegistered" label="My company is VAT registered" defaultChecked={org.vatRegistered} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="VAT number" name="vatNumber" defaultValue={org.vatNumber} />
                  <Field label="VAT rate (%)" name="vatRatePercent" inputMode="decimal" defaultValue={String(org.vatRateBps / 100)} />
                </div>
                <p className="mt-1 text-xs text-gray-600">Applies to new quotes. Existing quotes keep the rate they were created with.</p>
              </fieldset>
              <Field label="Quotes valid for (days)" name="quoteValidityDays" inputMode="numeric" defaultValue={String(org.quoteValidityDays)} />
              <TextArea label="Default quote terms and conditions" name="quoteTerms" defaultValue={org.quoteTerms} />
              <Check name="customerSignoffRequired" label="New jobs need customer sign-off before closing" defaultChecked={org.customerSignoffRequired} />
              <Submit>Save company settings</Submit>
            </Form>
          </Card>
        )}

        <div className="space-y-5" id="team">
          <Card title="Team">
            <ul className="divide-y divide-gray-200">
              {team.members.filter((m) => !m.clientId).map((m) => (
                <li key={m.id} className="py-3">
                  <p className="text-sm font-bold">{m.user.name} {!m.active && <Pill tone="red">Access removed</Pill>}</p>
                  <p className="muted">{m.user.email}</p>
                  {owner ? (
                    <Form action={a.updateMemberAction} hidden={{ membershipId: m.id }} className="mt-2 flex flex-wrap items-center gap-3">
                      {STAFF_ROLES.map(([v, l]) => <label key={v} className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" name="roles" value={v} defaultChecked={m.roles.includes(v)} />{l}</label>)}
                      <label className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" name="active" defaultChecked={m.active} />Active</label>
                      <Submit className="btn btn-secondary btn-sm">Save</Submit>
                    </Form>
                  ) : <p className="text-xs font-semibold text-gray-700">{m.roles.join(", ").toLowerCase()}</p>}
                </li>
              ))}
            </ul>
            {team.invitations.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <p className="mb-1 text-xs font-bold uppercase text-gray-600">Pending invitations</p>
                <ul className="space-y-1 text-sm">{team.invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2"><span>{i.email} <span className="text-gray-600">· {i.roles.join(", ").toLowerCase()} · expires {fmtDate(i.expiresAt)}</span></span>
                    {owner && <ActionButton action={a.revokeInviteAction} hidden={{ id: i.id }} className="btn btn-secondary btn-sm">Cancel</ActionButton>}</li>
                ))}</ul>
              </div>
            )}
          </Card>
          {owner && (
            <Card title="Invite a team member">
              <LinkForm action={a.inviteAction} submit="Send invitation" shareLabel="Invitation created">
                <Field label="Email" name="email" type="email" required />
                <Field label="Name" name="name" />
                <fieldset><legend className="label">Role</legend>
                  {STAFF_ROLES.map(([v, l]) => <label key={v} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="roles" value={v} defaultChecked={v === "TECHNICIAN"} className="h-4 w-4" />{l}</label>)}
                </fieldset>
              </LinkForm>
              <p className="muted mt-2">Customer users are invited from the customer's page.</p>
            </Card>
          )}
        </div>

        {owner && (
          <Card title="Response expectations by priority">
            <p className="muted mb-3">Used to set each new request's due date. Priority never authorises work by itself.</p>
            <Form action={a.savePrioritiesAction}>
              <table className="w-full text-sm">
                <thead><tr><th className="th">Priority</th><th className="th">Respond within (h)</th><th className="th">Complete within (h)</th></tr></thead>
                <tbody>{(["LOW", "NORMAL", "HIGH", "CRITICAL"] as const).map((p) => {
                  const r = rules.find((x) => x.priority === p);
                  return (
                    <tr key={p}><td className="td font-bold">{p[0] + p.slice(1).toLowerCase()}</td>
                      <td className="td"><input name={`${p}_response`} aria-label={`${p} response hours`} defaultValue={r?.responseHours ?? 24} inputMode="numeric" className="input !min-h-9 w-24" /></td>
                      <td className="td"><input name={`${p}_completion`} aria-label={`${p} completion hours`} defaultValue={r?.completionHours ?? 120} inputMode="numeric" className="input !min-h-9 w-24" /></td></tr>
                  );
                })}</tbody>
              </table>
              <Submit>Save expectations</Submit>
            </Form>
          </Card>
        )}

        {owner && (
          <Card title="Subscription">
            {org.isDemo ? <p className="text-sm">This is a demo workspace. It has no subscription and no limits.</p> : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs font-bold uppercase text-gray-600">Plan</dt><dd className="font-bold">{sub?.planName}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-gray-600">Status</dt><dd><Pill tone={sub?.access === "full" ? "green" : sub?.access === "grace" ? "amber" : "red"}>{sub?.status}</Pill> {sub?.endsAt && <span className="text-gray-600">until {fmtDate(sub.endsAt)}</span>}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-gray-600">Team members</dt><dd>{used.users} of {lim(plan?.maxUsers)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-gray-600">Open jobs</dt><dd>{used.activeJobs} of {lim(plan?.maxActiveJobs)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-gray-600">Customers</dt><dd>{used.clients} of {lim(plan?.maxClients)}</dd></div>
              </dl>
            )}
            <p className="muted mt-3">To change plan, contact us. If a subscription lapses your account becomes read-only: your records are never deleted and remain available to view and print.</p>
          </Card>
        )}

        {owner && !org.isDemo && (
          <Card title="Support access">
            <p className="muted mb-3">FixRelay staff cannot see your data. If you need help, you can grant read-only access for a limited time. Every visit is recorded in your history.</p>
            <ul className="mb-3 space-y-2 text-sm">{grants.map((g) => {
              const live = !g.revokedAt && g.expiresAt > new Date();
              return (
                <li key={g.id} className="flex items-center justify-between gap-2"><span>{g.reason} <span className="text-gray-600">· {live ? `until ${fmtDateTime(g.expiresAt)}` : g.revokedAt ? "revoked" : "expired"}</span></span>
                  {live && <ActionButton action={a.revokeSupportAction} hidden={{ id: g.id }} className="btn btn-danger btn-sm">Revoke</ActionButton>}</li>
              );
            })}</ul>
            <Form action={a.grantSupportAction}>
              <Field label="Reason" name="reason" required placeholder="What do you need help with?" />
              <div><label className="label" htmlFor="hours">Duration</label><select id="hours" name="hours" className="input"><option value="4">4 hours</option><option value="24">24 hours</option><option value="72">3 days</option></select></div>
              <Submit className="btn btn-secondary">Grant read-only support access</Submit>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
