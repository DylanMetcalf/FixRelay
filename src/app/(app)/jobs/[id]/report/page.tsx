import Link from "@/components/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import { PrintButton } from "@/components/print";
import { fmtDate, fmtDateTime } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { formatZar } from "@/lib/money";
import { getJob } from "@/server/services/jobs";
import { STATUS_LABEL } from "@/server/workflow";

export const metadata = { title: "Job report" };

/** Printable job report: details, quotes, work, evidence, sign-off and the full audit history. Use Print → Save as PDF. */
export default async function JobReport({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, org } = await requireSession();
  const job = await getJob(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const name = (id: string | null | undefined) => (id ? (job.people[id] ?? "Unknown") : "—");
  const photos = job.attachments.filter((a) => a.mimeType.startsWith("image/") && a.kind !== "SIGNATURE");
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 mt-6 border-b-2 border-gray-800 pb-1 text-sm font-extrabold uppercase tracking-wide">{children}</h2>;
  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-sm shadow-sm print:p-0 print:shadow-none">
      <div className="no-print mb-4 flex gap-2"><Link href={`/jobs/${job.id}`} className="btn btn-secondary">← Back to job</Link><PrintButton /></div>
      <header className="flex items-start justify-between gap-4 border-b-4 pb-3" style={{ borderColor: "var(--brand)" }}>
        <div><p className="text-xl font-extrabold">{org.name}</p><p className="text-gray-600">Maintenance job report</p></div>
        <div className="text-right"><p className="text-lg font-extrabold">{job.reference}</p><p>{STATUS_LABEL[job.status]}</p><p className="text-xs text-gray-600">Generated {fmtDateTime(new Date())}</p></div>
      </header>
      <H>Job</H>
      <p className="text-base font-bold">{job.title}</p>
      <p className="whitespace-pre-line">{job.description}</p>
      <table className="mt-2 w-full"><tbody>
        {[["Customer", job.client.name], ["Site", `${job.site.name}${job.site.address ? `, ${job.site.address}` : ""}`], ["Location", job.location?.name ?? "—"], ["Asset", job.asset ? `${job.asset.reference} – ${job.asset.name}` : "—"],
          ["Category / priority", `${job.category} / ${job.priority}${job.emergency ? " (emergency)" : ""}`], ["Reported", `${fmtDateTime(job.reportedAt)} by ${name(job.requesterId)}`],
          ["Technician", name(job.leadTechnicianId)], ["Work completed", fmtDateTime(job.completedAt)], ["Closed", fmtDateTime(job.closedAt)]].map(([k, v]) => (
          <tr key={k}><th className="w-44 py-0.5 pr-3 text-left align-top font-semibold text-gray-600">{k}</th><td>{v}</td></tr>
        ))}
      </tbody></table>

      {job.assessments.length > 0 && <><H>Assessment</H>{job.assessments.map((a) => <p key={a.id} className="whitespace-pre-line"><strong>{fmtDate(a.createdAt)} – {name(a.authorId)}:</strong> {a.findings}{a.recommendedWork && `\nRecommended: ${a.recommendedWork}`}</p>)}</>}

      {job.quotes.length > 0 && (
        <><H>Quotations</H>
          <table className="w-full"><thead><tr className="text-left text-xs text-gray-600"><th>Quote</th><th>Status</th><th>Decision</th><th className="text-right">Total</th></tr></thead><tbody>
            {job.quotes.map((q) => (
              <tr key={q.id} className="border-t border-gray-200"><td className="py-1">{q.number} v{q.version}{q.kind === "VARIATION" ? " (variation)" : ""}</td><td>{q.status}</td>
                <td>{q.decision ? `${q.decision.deciderName}, ${fmtDateTime(q.decision.createdAt)}` : "—"}</td><td className="text-right tabular-nums">{formatZar(q.totalCents)}</td></tr>
            ))}
          </tbody></table></>
      )}

      {job.updates.length > 0 && <><H>Work log</H>{[...job.updates].reverse().map((u) => <p key={u.id} className="mb-1"><strong>{fmtDateTime(u.createdAt)} – {name(u.authorId)}:</strong> {u.note}{u.labourMinutes > 0 && ` [${(u.labourMinutes / 60).toFixed(1)} h]`}{u.materialCostCents > 0 && ` [materials ${formatZar(u.materialCostCents)}]`}</p>)}</>}

      {job.completions.length > 0 && (
        <><H>Completion and sign-off</H>
          {[...job.completions].reverse().map((c) => (
            <div key={c.id} className="mb-3 break-inside-avoid">
              <p><strong>Version {c.version}</strong> – completed {fmtDateTime(c.completedAt)} by {name(c.submittedById)}</p>
              <p className="whitespace-pre-line">{c.workPerformed}</p>
              {c.observations && <p><em>Observations:</em> {c.observations}</p>}
              {c.decision ? (
                <div className="mt-1 flex items-end gap-4">
                  <p><strong>{c.decision.outcome}</strong> by {c.decision.deciderName} on {fmtDateTime(c.decision.createdAt)} ({c.decision.via.replace("_", " ").toLowerCase()}){c.decision.comment && ` – “${c.decision.comment}”`}</p>
                  {c.decision.signatureAttachmentId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${c.decision.signatureAttachmentId}`} alt="Signature" className="h-16 border border-gray-300" />
                  )}
                </div>
              ) : <p>Awaiting verification.</p>}
            </div>
          ))}
          <p className="text-xs text-gray-600">Drawn signatures record the signer's acknowledgement at the stated time. They are not advanced electronic signatures.</p></>
      )}

      {photos.length > 0 && (
        <><H>Evidence</H>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <figure key={p.id} className="break-inside-avoid">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${p.id}`} alt={p.filename} className="aspect-square w-full border border-gray-300 object-cover" />
                <figcaption className="text-xs text-gray-600">{p.kind.replace("_", " ").toLowerCase()} · {fmtDate(p.createdAt)}</figcaption>
              </figure>
            ))}
          </div></>
      )}

      <H>Activity history</H>
      <table className="w-full" data-testid="report-history"><tbody>
        {job.events.map((e) => <tr key={e.id} className="border-t border-gray-200 align-top"><td className="w-40 py-1 pr-2 text-xs text-gray-600">{fmtDateTime(e.createdAt)}</td><td className="pr-2">{e.summary}</td><td className="w-40 text-xs text-gray-600">{e.actorLabel}</td></tr>)}
      </tbody></table>
    </article>
  );
}
