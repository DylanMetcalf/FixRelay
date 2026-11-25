import { PRIORITY_LABEL } from "@/server/workflow";
import * as a from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { LinkForm } from "@/components/client-forms";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, Check, Field, fmtDate, fmtDateTime, PageHeader, Pill, TextArea } from "@/components/ui";
import { prisma } from "@/lib/db";
import { can } from "@/server/permissions";
import { usage } from "@/server/services/billing";
import { listSites } from "@/server/services/sites";
import { listSupportGrants, listTeam } from "@/server/services/orgs";
import { listDepartments } from "@/server/services/departments";
import { DepartmentsCard } from "./departments";
import { ApprovalsCard, JoinCodesCard } from "./registration";
import { listJoinCodes, listPendingMembers } from "@/server/services/registration";

export const metadata = { title: "Settings" };
const ROLES = [
  ["OWNER", "Owner / administrator", "Everything, incl. settings and team"],
  ["MANAGER", "Maintenance manager", "Runs jobs, quotes, contractors; approves up to the manager limit"],
  ["APPROVER", "Approver (site / finance)", "Approves spend up to the approver limit; sees all jobs"],
  ["TECHNICIAN", "Technician", "Assessments and in-house work on assigned jobs"],
  ["STORES", "Stores / procurement", "Issues and buys spares; sees jobs that need spares"],
  ["REQUESTER", "Reports faults only", "Reports faults and follows their own reports (free)"],
] as const;

export default async function Settings() {
  const { ctx, subscription: sub } = await requirePage("team.view");
  const owner = can(ctx, "org.manage");
  const admin = can(ctx, "team.manage");
  const [org, team, rules, grants, used, sites, depts, pending, codes] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { subscription: { include: { plan: true } } } }),
    listTeam(ctx), prisma.priorityRule.findMany({ where: { orgId: ctx.orgId } }), owner ? listSupportGrants(ctx) : [], usage(prisma, ctx.orgId),
    listSites(ctx), listDepartments(ctx, { withMembers: true }),
    admin ? listPendingMembers(ctx) : [], admin ? listJoinCodes(ctx) : [],
  ]);
  const people = team.members.filter((m) => m.active).map((m) => ({ userId: m.user.id, name: m.user.name }));
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
                <Field label="Brand colour" name="brandColour" type="color" defaultValue={org.brandColour} hint="Used for buttons, emails and your public pages." />
                <Field label="Logo" name="logo" hint="PNG, JPEG or WebP, up to 1 MB. Also used as the app icon."><input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="input" /></Field>
              </div>
              <fieldset className="rounded-md border border-gray-300 p-3">
                <legend className="px-1 text-sm font-bold">Fault reporting</legend>
                <Check name="reporterConfirmation" label="The person who reported a fault confirms it is fixed" defaultChecked={org.reporterConfirmation} />
                <Check name="publicReportingEnabled" label="Anyone with a site link or QR code can report without an account" defaultChecked={org.publicReportingEnabled} />
                <p className="mt-1 text-xs text-gray-600">Reports without an account are marked for your team to screen. Reporters only give a name and phone number and cannot see anything else.</p>
              </fieldset>
              <Submit>Save company settings</Submit>
            </Form>
          </Card>
        )}

        <div className="space-y-5" id="team">
          {admin && <div id="approvals"><ApprovalsCard pending={pending} departments={depts.map((d) => ({ id: d.id, name: d.name }))} /></div>}
          <Card title="Team">
            <ul className="divide-y divide-gray-200">
              {team.members.map((m) => (
                <li key={m.id} className="py-3">
                  <p className="text-sm font-bold">{m.user.name}{m.user.jobTitle && <span className="font-normal text-gray-700"> · {m.user.jobTitle}</span>} {!m.active && <Pill tone="red">Access removed</Pill>}</p>
                  <p className="muted">{m.user.email}</p>
                  {owner ? (
                    <Form action={a.updateMemberAction} hidden={{ membershipId: m.id }} className="mt-2 flex flex-wrap items-center gap-3">
                      {ROLES.map(([v, l]) => <label key={v} className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" name="roles" value={v} defaultChecked={m.roles.includes(v)} />{l}</label>)}
                      <SiteBoxes sites={sites} selected={m.siteIds} />
                      <label className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" name="active" defaultChecked={m.active} />Active</label>
                      <Submit className="btn btn-secondary btn-sm">Save</Submit>
                    </Form>
                  ) : <p className="text-xs font-semibold text-gray-700">{m.roles.map((r) => ROLES.find((x) => x[0] === r)?.[1] ?? r).join(", ")}{m.siteIds.length ? ` · ${m.siteIds.length} site${m.siteIds.length === 1 ? "" : "s"}` : " · all sites"}</p>}
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
          {admin && <JoinCodesCard codes={codes} sites={sites.map((x) => ({ id: x.id, name: x.name }))} />}
          <div id="departments"><DepartmentsCard departments={depts} people={people} canEdit={can(ctx, "team.manage")} /></div>
          {(owner || can(ctx, "sites.manage")) && (
            <Card title="Invite someone">
              <LinkForm action={a.inviteAction} submit="Send invitation" shareLabel="Invitation created">
                <Field label="Email" name="email" type="email" required />
                <Field label="Name" name="name" />
                <fieldset><legend className="label">Role</legend>
                  {ROLES.filter(([v]) => owner || v === "REQUESTER").map(([v, l, d]) => (
                    <label key={v} className="flex min-h-9 items-start gap-2 py-1 text-sm"><input type="checkbox" name="roles" value={v} defaultChecked={v === (owner ? "TECHNICIAN" : "REQUESTER")} className="mt-0.5 h-4 w-4" /><span><strong>{l}</strong><span className="block text-xs text-gray-600">{d}</span></span></label>
                  ))}
                </fieldset>
                {sites.length > 1 && <SiteBoxes sites={sites} selected={[]} label="Only these sites (leave empty for all)" />}
              </LinkForm>
              {!owner && <p className="muted mt-2">Only the owner can invite managers, approvers and technicians.</p>}
            </Card>
          )}
          {owner && (
            <Card title="Maintenance work requisition">
              <p className="muted mb-3">Every fault becomes a numbered requisition, filled in digitally as the job moves along. To continue your paper book, leave the prefix empty and set the next number.</p>
              <Form action={a.saveRequisitionAction}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Number prefix (may be empty)" name="referencePrefix" defaultValue={org.referencePrefix} maxLength={10} placeholder="e.g. REQ-" />
                  <Field label={`Next number (last used: ${org.jobSeq})`} name="nextNumber" inputMode="numeric" placeholder={String(org.jobSeq + 1)} />
                </div>
                <p className="text-xs text-gray-600">Next requisition: <strong>{org.referencePrefix}{String(org.jobSeq + 1).padStart(5, "0")}</strong>. Numbers only go up and are never reused.</p>
                <Check name="requireSignatures" label="Require signatures on every line: submitted by, received by maintenance, quote sign-off, work completed by, confirmed by originator and confirmed by manager" defaultChecked={org.requireSignatures} />
                <Submit>Save requisition settings</Submit>
              </Form>
            </Card>
          )}
          {owner && (
            <Card title="Approval rules">
              <p className="muted mb-3">Who may approve contractor quotes, by amount incl. VAT. Owners can approve any amount. Changes are recorded in the history.</p>
              <Form action={a.saveApprovalRulesAction}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Maintenance managers up to (R)" name="managerLimit" inputMode="decimal" defaultValue={(org.managerApprovalLimitCents / 100).toFixed(2)} />
                  <Field label="Approvers up to (R) – empty = no limit" name="approverLimit" inputMode="decimal" defaultValue={org.approverApprovalLimitCents == null ? "" : (org.approverApprovalLimitCents / 100).toFixed(2)} />
                  <Field label="Several quotes needed above (R)" name="quoteThreshold" inputMode="decimal" defaultValue={(org.multiQuoteThresholdCents / 100).toFixed(2)} />
                  <Field label="Number of quotes needed" name="minQuotes" inputMode="numeric" defaultValue={String(org.minQuotes)} />
                </div>
                <Check name="poRequired" label="A purchase order (PO) number is required to approve a quote" defaultChecked={org.poRequired} />
                <Submit>Save approval rules</Submit>
              </Form>
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
                    <tr key={p}><td className="td font-bold">{PRIORITY_LABEL[p]}</td>
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
                <div><dt className="text-xs font-bold uppercase text-gray-600">Sites</dt><dd>{used.sites} of {lim(plan?.maxSites)}</dd></div>
              </dl>
            )}
            <p className="muted mt-3">To change plan, contact us. If a subscription lapses your account becomes read-only: your records are never deleted and remain available to view and print.</p>
          </Card>
        )}

        {owner && (
          <Card title="Your data">
            <p className="muted mb-3">Download every record of your company (jobs, quotes, decisions, history and a list of files) as a JSON file. This works even if your subscription has lapsed. Each download is recorded in your history.</p>
            <a href="/api/export" className="btn btn-secondary" download>Export all company data</a>
          </Card>
        )}

        {owner && !org.isDemo && (
          <Card title="Support access">
            <p className="muted mb-3">ManOp staff cannot see your data. If you need help, you can grant read-only access for a limited time. Every visit is recorded in your history.</p>
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

function SiteBoxes({ sites, selected, label = "Sites" }: { sites: { id: string; name: string }[]; selected: string[]; label?: string }) {
  if (sites.length < 2) return null;
  return (
    <fieldset className="w-full"><legend className="text-xs font-bold text-gray-700">{label}</legend>
      <div className="flex flex-wrap gap-x-3">{sites.map((st) => <label key={st.id} className="flex items-center gap-1 text-xs"><input type="checkbox" name="siteIds" value={st.id} defaultChecked={selected.includes(st.id)} />{st.name}</label>)}</div>
    </fieldset>
  );
}
