import { notFound } from "next/navigation";
import { requirePage } from "@/app/_lib/session";
import Link from "@/components/link";
import { PrintButton } from "@/components/print";
import { Card, fmtDate, fmtDateTime, PageHeader, QuotePill } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { formatVatRate, formatZar } from "@/lib/money";
import { getQuote } from "@/server/services/quotes";

export const metadata = { title: "Quote" };

/** A contractor's quote: frozen once received. Decisions are made on the job page, where quotes are compared. */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePage("quote.view");
  const q = await getQuote(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  return (
    <>
      <PageHeader title={`${q.contractor?.name ?? "Quote"} – ${q.number}${q.version > 1 ? ` v${q.version}` : ""}`} subtitle={<><Link className="link" href={`/jobs/${q.job.id}`}>{q.job.reference}</Link> · {q.job.title} · {q.job.site.name}</>}>
        <PrintButton />
      </PageHeader>
      <div className="mb-4 flex items-center gap-2"><QuotePill status={q.status} />{q.versions[0]?.id !== q.id && <span className="muted">A newer version exists.</span>}</div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">What the quote covers</h3>
            <p className="whitespace-pre-line text-sm">{q.scope || "—"}</p>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm tabular-nums" data-testid="quote-doc">
              <div className="flex justify-between"><dt>Price excl. VAT</dt><dd>{formatZar(q.subtotalCents)}</dd></div>
              <div className="flex justify-between"><dt>{q.vatRateBps > 0 ? `VAT (${formatVatRate(q.vatRateBps)})` : "VAT (contractor not VAT registered)"}</dt><dd>{formatZar(q.vatCents)}</dd></div>
              <div className="flex justify-between border-t-2 border-gray-800 pt-1 text-base font-extrabold"><dt>Total</dt><dd data-testid="quote-total">{formatZar(q.totalCents)}</dd></div>
            </dl>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs font-bold uppercase text-gray-600">Can start within</dt><dd>{q.leadTimeDays != null ? `${q.leadTimeDays} days` : "—"}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-gray-600">Valid until</dt><dd>{fmtDate(q.validUntil)}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-gray-600">Received</dt><dd>{fmtDateTime(q.submittedAt)} {q.viaLink ? "(online)" : "(captured by staff)"}</dd></div>
            </dl>
            {q.attachments.length > 0 && <div className="no-print mt-3 flex flex-wrap gap-2">{q.attachments.map((f) => <a key={f.id} className="btn btn-secondary btn-sm" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">📄 {f.filename}</a>)}</div>}
          </Card>
          {q.decision && (
            <Card title="Decision">
              <p className="text-sm"><strong>{q.decision.outcome === "APPROVED" ? "Approved" : "Not approved"}</strong> by {q.decision.deciderName} on {fmtDateTime(q.decision.createdAt)}</p>
              {q.decision.comment && <p className="mt-1 text-sm italic">“{q.decision.comment}”</p>}
            </Card>
          )}
          <p className="no-print text-sm"><Link className="link" href={`/jobs/${q.job.id}`}>Compare all quotes and decide on the job page →</Link></p>
        </div>
        <Card title="Versions" className="self-start">
          <ul className="space-y-2 text-sm" data-testid="quote-versions">
            {q.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                {v.id === q.id ? <strong>Version {v.version}</strong> : <Link className="link" href={`/quotes/${v.id}`}>Version {v.version}</Link>}
                <span className="tabular-nums">{formatZar(v.totalCents)}</span><QuotePill status={v.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
