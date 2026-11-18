import Link from "@/components/link";
import { notFound } from "next/navigation";
import type { SignatureStep } from "@prisma/client";
import { requireSession } from "@/app/_lib/session";
import { PrintButton } from "@/components/print";
import { fmtDate, fmtDateTime } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { formatZar } from "@/lib/money";
import { getJob } from "@/server/services/jobs";
import { ROOT_CAUSE_LABEL, STATUS_LABEL } from "@/server/workflow";

export const metadata = { title: "Maintenance work requisition" };

const TZ = "Africa/Johannesburg";
const dateOnly = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }) : "");
const timeOnly = (d: Date | null | undefined) => (d ? d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }) : "");

/** A labelled line of the form, filled in or left blank like the paper version. */
function Line({ label, children, testid }: { label: string; children?: React.ReactNode; testid?: string }) {
  return (
    <div className="flex min-w-0 items-end gap-2" data-testid={testid}>
      <span className="shrink-0 whitespace-nowrap font-semibold">{label}</span>
      <span className="min-h-6 min-w-0 flex-1 border-b border-gray-700 pb-0.5">{children}</span>
    </div>
  );
}

const Box = ({ on, label }: { on: boolean; label: string }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap" data-checked={on ? "true" : "false"}>
    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center border-2 border-gray-800 text-[11px] font-black leading-none">{on ? "✕" : ""}</span>
    {label}<span className="sr-only">{on ? " (ticked)" : " (not ticked)"}</span>
  </span>
);

/** The maintenance work requisition, filled in from the job record. Use Print → Save as PDF for a copy. */
export default async function Requisition({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, org } = await requireSession();
  const job = await getJob(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const name = (id: string | null | undefined) => (id ? (job.people[id] ?? "Unknown") : "");
  const latest = job.completions[0] ?? null; // completions are newest first
  // The newest signature for each line; completion-related lines must belong to the latest completion.
  const sig = (step: SignatureStep) => [...job.signatures].reverse().find((x) => x.step === step && (!["COMPLETED", "ORIGINATOR", "MANAGER"].includes(step) || x.completionId === latest?.id));
  const Signature = ({ step, fallback }: { step: SignatureStep; fallback?: string }) => {
    const s = sig(step);
    return (
      <div className="flex min-w-0 flex-col items-center" data-testid={`sig-${step}`}>
        <div className="flex h-14 w-full items-end justify-center border-b border-gray-700 print:h-9">
          {s && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${s.attachmentId}`} alt={`Signature of ${s.name}`} className="max-h-14 max-w-full object-contain print:max-h-9" />
          )}
        </div>
        <span className="text-xs text-gray-700">Signature{s ? ` · ${fmtDateTime(s.signedAt)}` : fallback ? ` · ${fallback}` : ""}</span>
      </div>
    );
  };
  const reportedBy = job.requesterId ? name(job.requesterId) : `${job.reporterName ?? ""}${job.reporterPhone ? ` (${job.reporterPhone})` : ""}`;
  const received = sig("RECEIVED");
  const submittedTo = received?.name ?? (job.ownerId ? name(job.ownerId) : "");
  const completedBy = sig("COMPLETED")?.name ?? (latest ? (latest.submittedById ? name(latest.submittedById) : (job.contractor?.name ?? "")) : "");
  const originator = sig("ORIGINATOR");
  const manager = sig("MANAGER");
  const causes = new Set(latest?.rootCauses ?? []);
  const photos = job.attachments.filter((a) => a.mimeType.startsWith("image/") && a.kind !== "SIGNATURE");
  const approved = job.quotes.find((q) => q.status === "APPROVED");
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 mt-6 border-b-2 border-gray-800 pb-1 text-sm font-extrabold uppercase tracking-wide">{children}</h2>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap gap-2"><Link href={`/jobs/${job.id}`} className="btn btn-secondary">← Back to job</Link><PrintButton /></div>

      {/* ---------- Page 1: the requisition, laid out like the paper form ---------- */}
      <article className="bg-white p-6 text-sm leading-relaxed shadow-sm print:p-0 print:text-[12px] print:leading-snug print:shadow-none" data-testid="requisition">
        <header className="relative text-center">
          {org?.logoAttachmentId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${org.logoAttachmentId}`} alt="" className="absolute left-0 top-0 h-12 w-12 object-contain" />
          )}
          <p className="text-2xl font-black uppercase tracking-tight sm:text-3xl">{org?.name}</p>
          <p className="mt-1 text-base font-extrabold uppercase tracking-wide">Maintenance work requisition</p>
          <p className="mt-1 text-right font-mono text-xl font-bold text-red-700" data-testid="requisition-number">{job.reference}</p>
        </header>

        <section className="mt-3 space-y-3 print:space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Line label="Date reported:" testid="date-reported">{dateOnly(job.reportedAt)}</Line>
            <Line label="Reported time:">{timeOnly(job.reportedAt)}</Line>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1"><Line label="Area:">{[job.site.name, job.location?.name, job.asset ? `${job.asset.reference} ${job.asset.name}` : null].filter(Boolean).join(" · ")}</Line></div>
            <Box on={job.isProject} label="Projects" />
          </div>
          <div>
            <p className="font-semibold">Description of fault / breakdown:</p>
            <div className="min-h-20 border-b border-gray-700 pb-1 whitespace-pre-line print:min-h-12"><strong>{job.title}</strong>{"\n"}{job.description}</div>
          </div>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_14rem]">
            <Line label="Submitted by:" testid="submitted-by">{reportedBy}{job.source === "PUBLIC_LINK" ? " – via QR / site link" : ""}</Line>
            <Signature step="REPORTED" />
          </div>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_14rem]">
            <Line label="Submitted to:" testid="submitted-to">{submittedTo}</Line>
            <Signature step="RECEIVED" />
          </div>
        </section>

        <hr className="my-4 border-t-2 border-gray-800 print:my-2" />

        <section className="space-y-3 print:space-y-2">
          <Line label="Maintenance start date & time:" testid="start">{job.startedAt ? `${dateOnly(job.startedAt)}  ${timeOnly(job.startedAt)}` : ""}</Line>
          <div>
            <p className="font-semibold">Maintenance report:</p>
            <div className="min-h-20 border-b border-gray-700 pb-1 whitespace-pre-line print:min-h-12" data-testid="maintenance-report">
              {latest ? <>{latest.workPerformed}{latest.observations ? `\nObservations: ${latest.observations}` : ""}</> : ""}
              {job.route === "CONTRACTOR" && job.contractor && <span className="block text-xs text-gray-700">Done by contractor {job.contractor.name}{job.poNumber ? ` · PO ${job.poNumber}` : ""}{job.approvedCostCents != null ? ` · approved ${formatZar(job.approvedCostCents)} incl. VAT` : ""}</span>}
            </div>
          </div>
          {(job.location?.foodArea || latest?.toolsAndAreaOk != null) && (
            <p data-testid="tools-check-answer"><em>Food-handling area:</em> Tools out = Tools in and area is clean and tidy. <strong className="ml-2">Y/N:</strong>{" "}
              <span className="inline-block min-w-8 border-2 border-gray-800 px-1 text-center font-bold">{latest?.toolsAndAreaOk == null ? "" : latest.toolsAndAreaOk ? "Y" : "N"}</span></p>
          )}
          <div>
            <p className="font-semibold">Root cause:</p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2" data-testid="root-cause-boxes">
              {Object.entries(ROOT_CAUSE_LABEL).map(([k, l]) => <Box key={k} on={causes.has(k as never)} label={l} />)}
            </div>
            <div className="mt-2 min-h-10 border-b border-gray-700 pb-1 whitespace-pre-line">{latest?.rootCauseNotes}</div>
          </div>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <Line label="Date completed:" testid="date-completed">{dateOnly(latest?.completedAt)}</Line>
              <Line label="Time completed:">{timeOnly(latest?.completedAt)}</Line>
            </div>
            <div className="space-y-1">
              <Line label="By:" testid="completed-by">{completedBy}</Line>
              <Signature step="COMPLETED" />
            </div>
          </div>
        </section>

        <section className="mt-5 space-y-3 print:mt-3 print:space-y-2">
          <p className="font-semibold">I hereby confirm that the above reported problem has been resolved:</p>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_7rem_12rem]">
            <Line label="Confirmed by originator:" testid="confirmed-originator">{originator?.name ?? (latest?.decision?.outcome === "APPROVED" && latest.decision.via === "INTERNAL" ? `Confirmed by maintenance instead${latest.decision.comment ? `: ${latest.decision.comment}` : ""}` : "")}</Line>
            <div className="text-center"><div className="min-h-6 border-b border-gray-700">{dateOnly(originator?.signedAt ?? (latest?.decision?.outcome === "APPROVED" ? latest.decision.createdAt : null))}</div><span className="text-xs text-gray-700">Date</span></div>
            <Signature step="ORIGINATOR" />
          </div>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_7rem_12rem]">
            <Line label="Confirmed by manager:" testid="confirmed-manager">{manager?.name ?? ""}</Line>
            <div className="text-center"><div className="min-h-6 border-b border-gray-700">{dateOnly(manager?.signedAt ?? job.closedAt)}</div><span className="text-xs text-gray-700">Date</span></div>
            <Signature step="MANAGER" />
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap justify-between gap-2 border-t border-gray-300 pt-2 text-[11px] text-gray-600">
          <span>Status: <strong>{STATUS_LABEL[job.status]}</strong>{job.reopenCount > 0 ? ` · reopened ×${job.reopenCount}` : ""} · printed {fmtDateTime(new Date())}</span>
          <span>Dates and times are recorded automatically. Drawn signatures record each person&apos;s confirmation; they are not advanced electronic signatures.</span>
        </footer>
      </article>

      {/* ---------- Page 2: supporting records ---------- */}
      <article className="mt-6 break-before-page bg-white p-6 text-sm shadow-sm print:mt-0 print:p-0 print:shadow-none">
        <p className="text-base font-extrabold">{job.reference} · supporting records</p>

        {job.assessments.length > 0 && <><H>Assessment</H>{job.assessments.map((a) => <p key={a.id} className="whitespace-pre-line"><strong>{fmtDate(a.createdAt)} – {name(a.authorId)}:</strong> {a.findings}{a.recommendedWork && `\nRecommended: ${a.recommendedWork}`}</p>)}</>}

        {job.quotes.length > 0 && (
          <><H>Quotes and sign-off</H>
            <table className="w-full"><thead><tr className="text-left text-xs text-gray-600"><th>Contractor</th><th>Status</th><th>Signed off</th><th className="text-right">Total incl. VAT</th></tr></thead><tbody>
              {job.quotes.map((q) => {
                const s = job.signatures.find((x) => x.step === "APPROVAL" && x.quoteId === q.id);
                return (
                  <tr key={q.id} className="border-t border-gray-200 align-middle"><td className="py-1">{q.contractor?.name ?? q.number}{q.version > 1 ? ` v${q.version}` : ""}</td><td>{q.status.toLowerCase()}</td>
                    <td>{q.decision ? `${q.decision.deciderName}, ${fmtDateTime(q.decision.createdAt)}` : "—"}
                      {s && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${s.attachmentId}`} alt={`Signature of ${s.name}`} className="ml-2 inline h-8 align-middle" />
                      )}</td>
                    <td className="text-right tabular-nums">{formatZar(q.totalCents)}</td></tr>
                );
              })}
            </tbody></table>
            {approved && <p className="mt-1">Approved: {approved.contractor?.name} {formatZar(approved.totalCents)}{job.poNumber ? ` · PO ${job.poNumber}` : ""}{job.quoteExceptionReason ? ` · fewer quotes than required because: ${job.quoteExceptionReason}` : ""}</p>}
          </>
        )}

        {job.updates.length > 0 && <><H>Work log</H>{[...job.updates].reverse().map((u) => <p key={u.id} className="mb-1"><strong>{fmtDateTime(u.createdAt)} – {name(u.authorId)}:</strong> {u.note}{u.labourMinutes > 0 && ` [${(u.labourMinutes / 60).toFixed(1)} h]`}{u.materialCostCents > 0 && ` [materials ${formatZar(u.materialCostCents)}]`}</p>)}</>}

        {job.completions.length > 1 && (
          <><H>Earlier completions</H>
            {job.completions.slice(1).map((c) => <p key={c.id} className="mb-1"><strong>Version {c.version}, {fmtDateTime(c.completedAt)}:</strong> {c.workPerformed} – {c.decision ? `${c.decision.outcome.toLowerCase()} by ${c.decision.deciderName}${c.decision.comment ? ` (“${c.decision.comment}”)` : ""}` : "not decided"}</p>)}</>
        )}

        {photos.length > 0 && (
          <><H>Photos and evidence</H>
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
    </div>
  );
}
