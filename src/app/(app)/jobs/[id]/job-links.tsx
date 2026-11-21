import * as a from "@/app/actions/jobs";
import Link from "@/components/link";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, fmtDateTime, Pill, StatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { canHandOver, isManager, jobScope, type Ctx } from "@/server/permissions";
import type { JobView } from "@/server/services/jobs";

const brief = { id: true, reference: true, title: true, description: true, status: true, reportedAt: true, reporterName: true, requesterId: true } as const;

/** Possible duplicates (for a manager to review), linked duplicates, and repeat faults. */
export async function DuplicatesCard({ job, ctx }: { job: JobView; ctx: Ctx }) {
  const [candidates, linkedTo, duplicates, repeatOf, repeats] = await Promise.all([
    job.duplicateStatus === "FLAGGED" ? prisma.job.findMany({ where: { id: { in: job.possibleDuplicateIds }, ...jobScope(ctx) }, select: brief }) : [],
    job.duplicateOfId ? prisma.job.findFirst({ where: { id: job.duplicateOfId, ...jobScope(ctx) }, select: brief }) : null,
    prisma.job.findMany({ where: { duplicateOfId: job.id, ...jobScope(ctx) }, select: brief, orderBy: { reportedAt: "asc" } }),
    job.repeatOfId ? prisma.job.findFirst({ where: { id: job.repeatOfId, ...jobScope(ctx) }, select: brief }) : null,
    prisma.job.findMany({ where: { repeatOfId: job.id, ...jobScope(ctx) }, select: brief, orderBy: { reportedAt: "asc" } }),
  ]);
  const ids = [...new Set([...candidates, ...duplicates].map((j) => j.requesterId).filter((x): x is string => !!x))];
  const names = Object.fromEntries((ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const who = (j: { requesterId: string | null; reporterName: string | null }) => (j.requesterId ? names[j.requesterId] ?? "Staff member" : `${j.reporterName ?? "Unknown"} (QR)`);
  if (!candidates.length && !linkedTo && !duplicates.length && !repeatOf && !repeats.length) return null;
  const manage = isManager(ctx) && job.status !== "CLOSED";

  return (
    <Card title="Related reports" className={job.duplicateStatus === "FLAGGED" ? "!border-l-8 !border-l-amber-500" : ""}>
      <div className="space-y-3 text-sm" data-testid="related-reports">
        {candidates.length > 0 && (
          <div data-testid="duplicate-review">
            <p className="font-bold text-amber-900">This may be a duplicate. Compare the original reports below:</p>
            <ul className="mt-2 space-y-2">
              {candidates.map((c) => (
                <li key={c.id} className="rounded-md border border-gray-300 p-2">
                  <p><Link href={`/jobs/${c.id}`} className="link font-bold">{c.reference}</Link> · {c.title} <StatusBadge status={c.status} /></p>
                  <p className="text-xs text-gray-600">Reported {fmtDateTime(c.reportedAt)} by {who(c)}</p>
                  <p className="mt-1 line-clamp-3 text-gray-800">{c.description}</p>
                  {manage && <ActionButton action={a.linkDuplicateAction} hidden={{ jobId: job.id, originalId: c.id }} className="btn btn-secondary btn-sm mt-2" confirm={`Link ${job.reference} as a duplicate of ${c.reference}? Its reporter and photos are kept.`}>Link as duplicate of {c.reference}</ActionButton>}
                </li>
              ))}
            </ul>
            {manage && <ActionButton action={a.dismissDuplicateAction} hidden={{ jobId: job.id }} className="btn btn-secondary btn-sm mt-2">Not a duplicate – keep separate</ActionButton>}
            {!manage && <p className="mt-1 text-xs text-gray-600">A maintenance manager will review this.</p>}
          </div>
        )}
        {linkedTo && <p data-testid="duplicate-of"><Pill tone="amber">Duplicate</Pill> This report was linked to <Link href={`/jobs/${linkedTo.id}`} className="link font-bold">{linkedTo.reference}</Link> – {linkedTo.title}.</p>}
        {duplicates.length > 0 && (
          <div><p className="font-bold">Duplicate reports linked to this job ({duplicates.length})</p>
            <ul className="mt-1 space-y-1">{duplicates.map((d) => <li key={d.id}><Link href={`/jobs/${d.id}`} className="link">{d.reference}</Link> · reported {fmtDateTime(d.reportedAt)} by {who(d)}</li>)}</ul></div>
        )}
        {repeatOf && <p data-testid="repeat-of"><Pill tone="red">Repeat fault</Pill> The fault came back after <Link href={`/jobs/${repeatOf.id}`} className="link font-bold">{repeatOf.reference}</Link> – {repeatOf.title}.</p>}
        {repeats.length > 0 && (
          <div><p className="font-bold">The fault came back ({repeats.length})</p>
            <ul className="mt-1 space-y-1">{repeats.map((r) => <li key={r.id}><Link href={`/jobs/${r.id}`} className="link">{r.reference}</Link> · {fmtDateTime(r.reportedAt)} · <StatusBadge status={r.status} /></li>)}</ul></div>
        )}
      </div>
    </Card>
  );
}

/** Department and responsible person, with a handover form for maintenance managers and the department's manager. */
export async function HandoverCard({ job, ctx }: { job: JobView; ctx: Ctx }) {
  const open = job.status !== "CLOSED" && job.status !== "CANCELLED";
  const allowed = open && canHandOver(ctx, job);
  const [departments, people] = allowed ? await Promise.all([
    prisma.department.findMany({ where: { orgId: ctx.orgId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.membership.findMany({ where: { orgId: ctx.orgId, active: true, OR: [{ siteIds: { isEmpty: true } }, { siteIds: { has: job.siteId } }] }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]) : [[], []];
  if (!job.department && !allowed && job.handovers.length === 0) return null;
  const last = job.handovers.at(-1);
  return (
    <Card title="Department">
      <div className="space-y-2 text-sm" data-testid="department-card">
        <p>Responsible department: <strong data-testid="job-department">{job.department?.name ?? "Not set"}</strong></p>
        {job.ownerId && <p>Responsible person: <strong>{job.people[job.ownerId] ?? "—"}</strong></p>}
        {last && <p className="text-xs text-gray-600">Last handover {fmtDateTime(last.createdAt)} by {job.people[last.byUserId] ?? "—"}: {last.reason}</p>}
        {allowed && (departments.length > 0 || people.length > 0) && (
          <details className="action" data-testid="handover">
            <summary>Hand over this job</summary>
            <Form action={a.handoverAction} hidden={{ jobId: job.id }}>
              <label className="label" htmlFor="toDepartmentId">To department</label>
              <select id="toDepartmentId" name="toDepartmentId" className="input" defaultValue="">
                <option value="">Keep the department ({job.department?.name ?? "none"})</option>
                {departments.filter((d) => d.id !== job.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <label className="label" htmlFor="toUserId">To a person (optional)</label>
              <select id="toUserId" name="toUserId" className="input" defaultValue="">
                <option value="">No specific person</option>
                {people.map((p) => <option key={p.userId} value={p.userId}>{p.user.name}</option>)}
              </select>
              <label className="label" htmlFor="handover-reason">Reason or next action <span className="text-red-700">*</span></label>
              <textarea id="handover-reason" name="reason" required minLength={3} maxLength={1000} rows={2} className="input" placeholder="e.g. Production must clear the line before work can start" />
              <Submit>Hand over</Submit>
            </Form>
          </details>
        )}
      </div>
    </Card>
  );
}
