import type { SignatureStep } from "@prisma/client";
import Link from "@/components/link";
import { Card, fmtDateTime } from "@/components/ui";
import type { JobView } from "@/server/services/jobs";

/** The requisition's sections as stages of the job: done or waiting, who, when, and whether it is signed. */
export function RequisitionCard({ job }: { job: JobView }) {
  const name = (id: string | null | undefined) => (id ? (job.people[id] ?? "") : "");
  const latest = job.completions[0] ?? null;
  const sig = (step: SignatureStep) => [...job.signatures].reverse().find((x) => x.step === step && (!["COMPLETED", "ORIGINATOR", "MANAGER"].includes(step) || x.completionId === latest?.id));
  const approved = job.quotes.find((q) => q.status === "APPROVED");
  const rows: { key: string; title: string; done: boolean; who: string; when: Date | null; step?: SignatureStep; show?: boolean }[] = [
    { key: "reported", title: "Reported (submitted by)", done: true, who: job.requesterId ? name(job.requesterId) : (job.reporterName ?? ""), when: job.reportedAt, step: "REPORTED" },
    { key: "received", title: "Received by maintenance (submitted to)", done: !["NEW", "CANCELLED"].includes(job.status) || !!sig("RECEIVED"), who: sig("RECEIVED")?.name ?? name(job.ownerId), when: sig("RECEIVED")?.signedAt ?? null, step: "RECEIVED" },
    { key: "approval", title: "Quote signed off", done: !!approved?.decision, who: approved?.decision?.deciderName ?? "", when: approved?.decision?.createdAt ?? null, step: "APPROVAL", show: job.route === "CONTRACTOR" && job.quotes.length > 0 },
    { key: "started", title: "Maintenance started", done: !!job.startedAt, who: job.route === "CONTRACTOR" ? (job.contractor?.name ?? "") : name(job.leadTechnicianId), when: job.startedAt },
    { key: "completed", title: "Work completed (with root cause)", done: !!latest, who: sig("COMPLETED")?.name ?? (latest ? (latest.submittedById ? name(latest.submittedById) : (job.contractor?.name ?? "")) : ""), when: latest?.completedAt ?? null, step: "COMPLETED" },
    { key: "originator", title: "Confirmed by originator", done: latest?.decision?.outcome === "APPROVED", who: sig("ORIGINATOR")?.name ?? (latest?.decision?.outcome === "APPROVED" ? latest.decision.deciderName : ""), when: latest?.decision?.outcome === "APPROVED" ? latest.decision.createdAt : null, step: "ORIGINATOR" },
    { key: "manager", title: "Confirmed by manager (closed)", done: job.status === "CLOSED", who: sig("MANAGER")?.name ?? "", when: job.closedAt, step: "MANAGER" },
  ];
  const visible = rows.filter((r) => r.show !== false);
  const next = visible.find((r) => !r.done);
  return (
    <Card title="Requisition" aside={<Link className="link text-sm" href={`/jobs/${job.id}/report`}>Open the form</Link>}>
      <ol className="space-y-1.5" data-testid="requisition-stages">
        {visible.map((r) => {
          const s = r.step ? sig(r.step) : undefined;
          const current = next?.key === r.key && job.status !== "CANCELLED";
          return (
            <li key={r.key} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${current ? "bg-amber-50 ring-1 ring-amber-300" : ""}`} data-done={r.done ? "true" : "false"} data-stage={r.key}>
              <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${r.done ? "bg-green-700 text-white" : current ? "border-2 border-amber-500 bg-white text-amber-700" : "border-2 border-gray-300 bg-white"}`}>{r.done ? "✓" : ""}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.title}<span className="sr-only">{r.done ? " – done" : " – waiting"}</span></span>
                {r.done ? (
                  <span className="block text-xs text-gray-700">{r.who}{r.when ? ` · ${fmtDateTime(r.when)}` : ""}{r.step ? (s ? " · signed" : " · not signed") : ""}</span>
                ) : current ? <span className="block text-xs font-semibold text-amber-800">Next</span> : null}
              </span>
              {s && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${s.attachmentId}`} alt={`Signature of ${s.name}`} className="h-7 max-w-24 shrink-0 object-contain" />
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
