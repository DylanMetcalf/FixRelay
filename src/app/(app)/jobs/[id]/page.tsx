import { notFound } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import Link from "@/components/link";
import { Card, fmtDate, fmtDateTime, isOverdue, PageHeader, Pill, PriorityBadge, StatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatZar } from "@/lib/money";
import { can } from "@/server/permissions";
import { listContractors } from "@/server/services/contractors";
import { getJob } from "@/server/services/jobs";
import { markJobRead } from "@/server/services/notifications";
import { listAssignable } from "@/server/services/orgs";
import { nextAction, ROUTE_LABEL } from "@/server/workflow";
import { ActionsPanel } from "./actions-panel";
import { QuotesCard } from "./quotes-card";

export const metadata = { title: "Job" };

const KIND_LABEL: Record<string, string> = { REQUEST: "Reported with the fault", ASSESSMENT: "Assessment", PROGRESS: "Work in progress", BEFORE: "Before", AFTER: "After", TEST_DOCUMENT: "Test documents", QUOTE: "Quote documents", SIGNATURE: "Signatures" };
const VIA = { LINK: "secure link", PORTAL: "confirmed in the app", IN_PERSON: "signed on site", INTERNAL: "checked by the maintenance manager" } as const;

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const job = await getJob(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  if (!ctx.support) await markJobRead(ctx, job.id);
  const staff = can(ctx, "sites.view") || ctx.support;
  const [team, contractors, assessment] = await Promise.all([
    can(ctx, "job.manage") ? listAssignable(ctx, ["TECHNICIAN", "MANAGER", "OWNER"]) : [],
    can(ctx, "job.manage") ? listContractors(ctx, { activeOnly: true }) : [],
    prisma.assessment.findFirst({ where: { jobId: job.id, orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, select: { recommendedWork: true } }),
  ]);
  const next = nextAction(job);
  const name = (id: string | null | undefined) => (id ? (job.people[id] ?? "Unknown") : "—");
  const reporter = job.requesterId ? name(job.requesterId) : `${job.reporterName ?? "Unknown"} (public link)`;
  const who = { "Maintenance manager": job.ownerId ? name(job.ownerId) : "Any maintenance manager", Technician: job.leadTechnicianId ? name(job.leadTechnicianId) : "Unassigned",
    Contractor: job.contractor?.name ?? "—", Approver: "Site / finance approver", Reporter: reporter, Nobody: "—" }[next.party];
  const groups = Object.keys(KIND_LABEL).map((k) => ({ kind: k, items: job.attachments.filter((a) => a.kind === k) })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader title={job.title} subtitle={<><strong>{job.reference}</strong> · {job.site.name}{job.location && ` · ${job.location.name}`}</>}>
        <Link href={`/jobs/${job.id}/report`} className="btn btn-secondary">Job report</Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={job.status} /><PriorityBadge priority={job.priority} emergency={job.emergency} />
        {job.route !== "UNDECIDED" && <Pill tone="blue">{ROUTE_LABEL[job.route]}</Pill>}
        {isOverdue(job) && <Pill tone="red">Overdue since {fmtDate(job.dueAt)}</Pill>}
        {job.reopenCount > 0 && <Pill tone="amber">Reopened ×{job.reopenCount}</Pill>}
        {job.source === "PUBLIC_LINK" && <Pill tone="amber">Reported without an account</Pill>}
      </div>

      <div className="mb-5 rounded-lg border-l-8 bg-white p-4 shadow-sm" style={{ borderColor: "var(--brand)" }} data-testid="next-action">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">What happens next</p>
        <p className="text-lg font-extrabold text-gray-900">{next.label}</p>
        <p className="text-sm text-gray-700">Responsible: <strong>{next.party === "Nobody" ? "—" : `${next.party} – ${who}`}</strong></p>
        {job.status === "ON_HOLD" && <p className="mt-1 text-sm font-semibold text-orange-900">On hold: {job.holdReason}</p>}
        {job.status === "CANCELLED" && <p className="mt-1 text-sm font-semibold text-gray-800">Cancelled: {job.cancelReason}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ActionsPanel job={job} ctx={ctx} team={team.map((t) => ({ value: t.userId, label: `${t.user.name}${t.roles.includes("TECHNICIAN") ? "" : " (manager)"}` }))}
            contractors={contractors.map((c) => ({ value: c.id, label: `${c.name}${c.trade ? ` – ${c.trade}` : ""}` }))} suggestedScope={assessment?.recommendedWork || job.description} />

          {can(ctx, "quote.view") && <QuotesCard ctx={ctx} jobId={job.id} />}

          <Card title="Fault details">
            <p className="whitespace-pre-line text-sm">{job.description}</p>
            {job.source === "PUBLIC_LINK" && staff && (
              <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm" data-testid="public-reporter"><strong>Reported without an account by {job.reporterName}</strong>{job.reporterPhone && ` · ${job.reporterPhone}`}{job.reporterEmail && ` · ${job.reporterEmail}`}. Check it is genuine before sending anyone out.</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Item label="Site">{staff ? <Link className="link" href={`/sites/${job.site.id}`}>{job.site.name}</Link> : job.site.name}{job.site.address && <span className="block text-gray-600">{job.site.address}</span>}</Item>
              <Item label="Location">{job.location?.name ?? "—"}</Item>
              <Item label="Equipment">{job.asset ? (staff ? <Link className="link" href={`/assets/${job.asset.id}`}>{job.asset.reference} – {job.asset.name}</Link> : job.asset.name) : "—"}</Item>
              <Item label="Type">{job.category}</Item>
              <Item label="Reported by">{reporter}</Item>
              <Item label="Reported">{fmtDateTime(job.reportedAt)}</Item>
              <Item label="Due">{fmtDate(job.dueAt)}</Item>
              <Item label="Fixed by">{job.route === "CONTRACTOR" ? (job.contractor ? (staff ? <Link className="link" href={`/contractors/${job.contractor.id}`}>{job.contractor.name}</Link> : job.contractor.name) : "Contractor – getting quotes") : job.route === "IN_HOUSE" ? `In-house – ${name(job.leadTechnicianId)}` : "Not decided yet"}</Item>
              <Item label="Responsible manager">{name(job.ownerId)}</Item>
              {job.technicians.length > 0 && <Item label="Also working on it">{job.technicians.map((t) => name(t.userId)).join(", ")}</Item>}
              {(job.plannedStart || job.plannedEnd) && <Item label="Planned">{`${fmtDate(job.plannedStart)} → ${fmtDate(job.plannedEnd)}`}</Item>}
              {job.approvedCostCents != null && <Item label="Approved value">{formatZar(job.approvedCostCents)} incl. VAT</Item>}
              {job.poNumber && <Item label="PO number">{job.poNumber}</Item>}
              <Item label="Confirmation">{job.reporterConfirmation ? "Reporter confirms it is fixed" : "Maintenance manager confirms"}</Item>
            </dl>
            {job.instructions && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm"><strong>Instructions:</strong> {job.instructions}</p>}
            {job.directAuthReason && <p className="mt-3 text-sm text-gray-700"><strong>In-house note:</strong> {job.directAuthReason}</p>}
            {job.quoteExceptionReason && <p className="mt-3 text-sm text-gray-700"><strong>Fewer quotes than required:</strong> {job.quoteExceptionReason}</p>}
          </Card>

          {job.assessments.map((a) => (
            <Card key={a.id} title="Assessment" aside={<span className="muted">{name(a.authorId)} · {fmtDateTime(a.createdAt)}</span>}>
              <dl className="space-y-2 text-sm">
                <Item label="Findings">{a.findings}</Item>
                {a.suspectedCause && <Item label="Suspected cause">{a.suspectedCause}</Item>}
                {a.recommendedWork && <Item label="Recommended work">{a.recommendedWork}</Item>}
                {a.materials && <Item label="Materials needed">{a.materials}</Item>}
                <Item label="Labour estimate">{a.labourHoursEstimate ? `${a.labourHoursEstimate.toString()} h` : "—"}</Item>
              </dl>
              <div className="mt-2 flex gap-2"><Pill tone={a.quoteRequired ? "amber" : "green"}>{a.quoteRequired ? "Contractor quote suggested" : "Can be done in-house"}</Pill>{a.externalHelpRequired && <Pill tone="red">Specialist needed</Pill>}</div>
            </Card>
          ))}

          {job.updates.length > 0 && (
            <Card title="Work log">
              <ul className="space-y-3">
                {job.updates.map((u) => (
                  <li key={u.id} className="border-l-4 border-gray-300 pl-3 text-sm">
                    <p className="text-xs text-gray-600"><strong>{name(u.authorId)}</strong> · {fmtDateTime(u.createdAt)} {u.kind !== "PROGRESS" && <Pill tone={u.kind === "NOTE" ? "gray" : "amber"}>{u.kind.replace("_", " ").toLowerCase()}</Pill>}</p>
                    <p className="whitespace-pre-line">{u.note}</p>
                    {(u.labourMinutes > 0 || u.materialCostCents > 0 || u.materialDescription) && (
                      <p className="text-xs text-gray-700">{u.labourMinutes > 0 && `Labour: ${(u.labourMinutes / 60).toFixed(1)} h `}{u.materialDescription && `· Materials: ${u.materialDescription} `}{u.materialCostCents > 0 && `(${formatZar(u.materialCostCents)})`}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {job.completions.map((c) => (
            <Card key={c.id} title={`Completed work${job.completions.length > 1 ? ` (version ${c.version})` : ""}`} aside={<Pill tone={c.status === "APPROVED" ? "green" : c.status === "REJECTED" ? "red" : "amber"}>{c.status === "SUBMITTED" ? "Awaiting confirmation" : c.status === "APPROVED" ? "Confirmed fixed" : "Not fixed"}</Pill>}>
              <dl className="space-y-2 text-sm">
                <Item label="Work performed">{c.workPerformed}</Item>
                {c.observations && <Item label="Observations">{c.observations}</Item>}
                <Item label="Completed">{fmtDateTime(c.completedAt)} by {c.submittedById ? name(c.submittedById) : (job.contractor?.name ?? "contractor")}</Item>
              </dl>
              {c.decision && (
                <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
                  <p><strong>{c.decision.outcome === "APPROVED" ? "Confirmed fixed" : "Not fixed"}</strong> by {c.decision.deciderName} on {fmtDateTime(c.decision.createdAt)} <span className="text-gray-600">({VIA[c.decision.via]})</span></p>
                  {c.decision.comment && <p className="mt-1 italic">“{c.decision.comment}”</p>}
                  {c.decision.signatureAttachmentId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${c.decision.signatureAttachmentId}`} alt={`Signature of ${c.decision.deciderName}`} className="mt-2 h-20 rounded border border-gray-300 bg-white" />
                  )}
                </div>
              )}
            </Card>
          ))}

          {groups.length > 0 && (
            <Card title="Photos and documents">
              {groups.filter((g) => g.kind !== "SIGNATURE").map((g) => (
                <div key={g.kind} className="mb-3">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-600">{KIND_LABEL[g.kind]}</p>
                  <div className="flex flex-wrap gap-2">
                    {g.items.map((a) => a.mimeType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${a.id}`} alt={a.filename} loading="lazy" className="h-24 w-24 rounded-md border border-gray-300 object-cover" /></a>
                    ) : <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">📄 {a.filename}</a>)}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <Card title="Activity history" className="self-start">
          <ol className="space-y-3" data-testid="timeline">
            {[...job.events].reverse().map((e) => (
              <li key={e.id} className="border-l-2 border-gray-300 pl-3">
                <p className="text-sm font-semibold text-gray-900">{e.summary}</p>
                <p className="text-xs text-gray-600">{e.actorLabel} · {fmtDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-bold uppercase tracking-wide text-gray-600">{label}</dt><dd className="whitespace-pre-line text-gray-900">{children}</dd></div>;
}
