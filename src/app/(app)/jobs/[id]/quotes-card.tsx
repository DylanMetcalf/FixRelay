import * as a from "@/app/actions/jobs";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, Field, fmtDate, fmtDateTime, Pill, QuotePill, TextArea } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { approvalLimit, can, type Ctx } from "@/server/permissions";
import { compareQuotes } from "@/server/services/quotes";

/** Side-by-side contractor quotes with decision buttons that respect the viewer's spending authority. */
export async function QuotesCard({ ctx, jobId }: { ctx: Ctx; jobId: string }) {
  const { job, quotes, waitingFor, rules } = await compareQuotes(ctx, jobId);
  if (!quotes.length && !waitingFor.length) return null;
  const limit = approvalLimit(ctx, rules);
  const manage = can(ctx, "quote.manage");
  const approver = can(ctx, "spend.approve");
  const count = new Set(quotes.filter((q) => q.status !== "WITHDRAWN").map((q) => q.contractorId)).size;
  const open = quotes.filter((q) => q.status === "SUBMITTED");
  const cheapest = open[0]?.id;
  const limitText = (n: number) => (n === Number.POSITIVE_INFINITY ? "no limit" : formatZar(n));
  return (
    <Card title="Contractor quotes" aside={<span className="muted">{count} received{waitingFor.length ? ` · waiting for ${waitingFor.length}` : ""}</span>}>
      <p className="mb-3 text-xs text-gray-700" data-testid="quote-rules">
        Rules: {rules.minQuotes} quotes needed above {formatZar(rules.multiQuoteThresholdCents)}{rules.poRequired ? " · PO number required" : ""} · your approval limit: <strong>{limitText(limit)}</strong>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="quote-compare">
          <thead><tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-600"><th className="py-1">Contractor</th><th className="text-right">Excl. VAT</th><th className="text-right">Total</th><th className="px-2">Starts in</th><th>Valid to</th><th>Status</th></tr></thead>
          <tbody className="divide-y divide-gray-200">
            {quotes.map((q) => (
              <tr key={q.id} className={q.id === job.recommendedQuoteId ? "bg-amber-50" : ""}>
                <td className="py-2"><Link className="link" href={`/quotes/${q.id}`}>{q.contractor!.name}</Link>
                  {q.id === cheapest && open.length > 1 && <> <Pill tone="green">Cheapest</Pill></>}
                  {q.id === job.recommendedQuoteId && <> <Pill tone="amber">Recommended</Pill></>}
                  <span className="block text-xs text-gray-600">{q.number}{q.version > 1 ? ` v${q.version}` : ""} · {q.viaLink ? "submitted online" : "captured by staff"} · {fmtDateTime(q.submittedAt)}</span>
                  {q.files.map((f) => <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="mr-2 text-xs underline">📄 {f.filename}</a>)}
                </td>
                <td className="whitespace-nowrap pl-2 text-right tabular-nums">{formatZar(q.subtotalCents)}</td>
                <td className="whitespace-nowrap pl-2 text-right font-bold tabular-nums">{formatZar(q.totalCents)}</td>
                <td className="whitespace-nowrap px-2">{q.leadTimeDays != null ? `${q.leadTimeDays} d` : "—"}</td>
                <td>{fmtDate(q.validUntil)}</td>
                <td className="whitespace-nowrap"><QuotePill status={q.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {waitingFor.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {waitingFor.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2"><span className="text-gray-700">Waiting for <strong>{w.name}</strong> (link expires {fmtDate(w.expiresAt)})</span>
              {manage && job.status === "QUOTING" && <Form action={a.withdrawInviteAction} hidden={{ jobId, contractorId: w.id }} className="inline"><Submit className="btn btn-secondary btn-sm">Stop waiting</Submit></Form>}
            </li>
          ))}
        </ul>
      )}

      {job.status === "QUOTING" && (manage || approver) && open.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-gray-200 pt-3">
          <p className="text-sm font-bold">Choose a quote</p>
          {open.map((q) => {
            const within = q.totalCents <= limit;
            const needsReason = q.totalCents > rules.multiQuoteThresholdCents && count < rules.minQuotes;
            return (
              <details key={q.id} className="action" data-testid={`choose-${q.contractor!.name}`}>
                <summary>{within ? "Approve" : "Send for approval"}: {q.contractor!.name} – {formatZar(q.totalCents)}</summary>
                <Form action={within ? a.approveQuoteAction : a.recommendQuoteAction} hidden={{ quoteId: q.id }}>
                  {!within && <p className="text-sm text-gray-700">This is above your limit of {limitText(limit)}. It will go to someone who can approve {formatZar(q.totalCents)}.</p>}
                  {within && rules.poRequired && <Field label="Purchase order (PO) number" name="poNumber" required />}
                  {within && !rules.poRequired && <Field label="Purchase order (PO) number (optional)" name="poNumber" />}
                  {needsReason && <TextArea label={`Only ${count} of ${rules.minQuotes} required quotes – why go ahead?`} name="exceptionReason" required rows={2} placeholder="e.g. specialist supplier, emergency, no other contractor available" />}
                  <TextArea label="Comment (optional)" name="comment" rows={2} />
                  <Submit>{within ? "Approve and appoint contractor" : "Send for approval"}</Submit>
                </Form>
              </details>
            );
          })}
        </div>
      )}

      {job.status === "AWAITING_APPROVAL" && approver && (() => {
        const q = quotes.find((x) => x.id === job.recommendedQuoteId);
        if (!q) return null;
        if (q.totalCents > limit) return <p className="mt-4 text-sm text-gray-700">Waiting for someone who can approve {formatZar(q.totalCents)} (your limit is {limitText(limit)}).</p>;
        return (
          <div className="mt-4 grid gap-3 border-t border-gray-200 pt-3 md:grid-cols-2" data-testid="approval-decision">
            <Form action={a.approveQuoteAction} hidden={{ quoteId: q.id }}>
              <p className="text-sm font-bold">Approve {q.contractor!.name} – {formatZar(q.totalCents)}</p>
              <Field label={`PO number${rules.poRequired ? "" : " (optional)"}`} name="poNumber" required={rules.poRequired} />
              <TextArea label="Comment (optional)" name="comment" rows={2} />
              <Submit>Approve</Submit>
            </Form>
            <Form action={a.rejectRecommendationAction} hidden={{ jobId }}>
              <p className="text-sm font-bold">Not approved</p>
              <TextArea label="Why? (the maintenance team will see this)" name="comment" required rows={3} />
              <Submit className="btn btn-danger">Do not approve</Submit>
            </Form>
          </div>
        );
      })()}
    </Card>
  );
}
