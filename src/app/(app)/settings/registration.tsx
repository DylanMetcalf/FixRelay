import * as a from "@/app/actions/admin";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, fmtDate, fmtDateTime, Pill } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import type { listJoinCodes, listPendingMembers } from "@/server/services/registration";

const ROLE_CHOICES = [
  ["REQUESTER", "Reports faults only"], ["TECHNICIAN", "Technician"], ["STORES", "Stores"], ["MANAGER", "Maintenance manager"], ["APPROVER", "Approver"], ["OWNER", "Administrator"],
] as const;

type Pending = Awaited<ReturnType<typeof listPendingMembers>>;
type Codes = Awaited<ReturnType<typeof listJoinCodes>>;

/** People who registered with a site code and are waiting; the administrator chooses role and department. */
export function ApprovalsCard({ pending, departments }: { pending: Pending; departments: { id: string; name: string }[] }) {
  return (
    <Card title={`Waiting for approval${pending.length ? ` (${pending.length})` : ""}`} className={pending.length ? "!border-l-8 !border-l-amber-500" : ""}>
      {pending.length === 0 ? <p className="muted">No one is waiting. People who register with a code appear here.</p> : (
        <ul className="space-y-4" data-testid="approvals">
          {pending.map((m) => (
            <li key={m.id} className="rounded-md border border-gray-300 p-3">
              <div className="flex items-center gap-3">
                {m.user.photoKey
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/avatar/${m.user.id}`} alt="" className="h-12 w-12 rounded-full object-cover" />
                  : <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 font-bold text-gray-700">{m.user.name.slice(0, 1)}</span>}
                <div>
                  <p className="font-bold">{m.user.name}{m.user.jobTitle && <span className="font-normal text-gray-700"> · {m.user.jobTitle}</span>}</p>
                  <p className="text-sm text-gray-700">{m.user.email}{m.user.phone && ` · ${m.user.phone}`}</p>
                  <p className="text-xs text-gray-600">Asked {fmtDateTime(m.createdAt)}{m.requestedDepartmentId && ` · department: ${departments.find((d) => d.id === m.requestedDepartmentId)?.name ?? "—"}`}</p>
                </div>
              </div>
              {!m.user.emailVerifiedAt && <p className="mt-2"><Pill tone="amber">Email not confirmed yet</Pill> <span className="text-xs text-gray-600">You can approve once they confirm it.</span></p>}
              <Form action={a.approveMemberAction} hidden={{ membershipId: m.id }} className="mt-3 space-y-2">
                <fieldset><legend className="text-xs font-bold uppercase text-gray-600">Role</legend>
                  <div className="flex flex-wrap gap-x-3">{ROLE_CHOICES.map(([v, l]) => <label key={v} className="flex min-h-9 items-center gap-1 text-sm"><input type="checkbox" name="roles" value={v} defaultChecked={v === "REQUESTER"} />{l}</label>)}</div>
                </fieldset>
                {departments.length > 0 && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs font-bold">Department
                      <select name="departmentId" defaultValue={m.requestedDepartmentId ?? ""} className="input !min-h-9 text-sm">
                        <option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label className="flex min-h-9 items-center gap-1 text-sm"><input type="checkbox" name="departmentManager" />Department manager</label>
                  </div>
                )}
                <Submit className="btn btn-primary btn-sm">Approve access</Submit>
              </Form>
              <ActionButton action={a.rejectMemberAction} hidden={{ membershipId: m.id }} className="btn btn-sm mt-2 underline" confirm={`Decline ${m.user.name}'s request?`}>Decline</ActionButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Site registration codes: share one with employees so they can ask for access. */
export function JoinCodesCard({ codes, sites }: { codes: Codes; sites: { id: string; name: string }[] }) {
  const site = (id: string | null) => (id ? sites.find((s) => s.id === id)?.name ?? "Site" : "All sites");
  return (
    <Card title="Registration codes">
      <p className="muted mb-3">Employees register at <strong>{appUrl().replace(/^https?:\/\//, "") || "your ManOp address"}/join</strong> with a code. A code never gives access by itself: you approve each person above. Replace a code if it is shared too widely.</p>
      <ul className="space-y-2" data-testid="join-codes">
        {codes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-300 p-2">
            <span><strong className="font-mono text-lg tracking-wider" data-testid="join-code">{c.code}</strong> <span className="text-xs text-gray-600">· {site(c.siteId)} · used {c.uses}× · expires {fmtDate(c.expiresAt)}</span>
              <span className="block text-xs text-gray-600">Link: {appUrl()}/join?code={c.code}</span></span>
            <span className="flex gap-2">
              <ActionButton action={a.regenerateJoinCodeAction} hidden={{ id: c.id }} className="btn btn-secondary btn-sm">Replace</ActionButton>
              <ActionButton action={a.revokeJoinCodeAction} hidden={{ id: c.id }} className="btn btn-secondary btn-sm" confirm="Switch this code off? It stops working immediately.">Switch off</ActionButton>
            </span>
          </li>
        ))}
        {codes.length === 0 && <li className="text-sm text-gray-600">No active codes.</li>}
      </ul>
      <Form action={a.createJoinCodeAction} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold">Site<select name="siteId" className="input !min-h-9 text-sm"><option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-xs font-bold">Valid for (days)<input name="days" type="number" min={1} max={365} defaultValue={30} className="input !min-h-9 w-24 text-sm" /></label>
        <Submit className="btn btn-primary btn-sm">Create code</Submit>
      </Form>
    </Card>
  );
}
