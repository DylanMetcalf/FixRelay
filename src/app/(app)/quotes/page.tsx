import { requirePage } from "@/app/_lib/session";
import Link from "@/components/link";
import { Empty, fmtDate, PageHeader, QuotePill, StatusBadge } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { listQuotes } from "@/server/services/quotes";

export const metadata = { title: "Quotes" };

export default async function Quotes({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { ctx } = await requirePage("quote.view");
  const f = await searchParams;
  const quotes = await listQuotes(ctx, f);
  const tabs = [["", "All"], ["SUBMITTED", "Open"], ["APPROVED", "Accepted"], ["REJECTED", "Not selected"]] as const;
  return (
    <>
      <PageHeader title="Quotes" subtitle="Quotes received from contractors. Compare and decide on each job's page." />
      <nav aria-label="Quote status" className="no-print mb-4 flex flex-wrap gap-2">
        {tabs.map(([v, l]) => <Link key={v} href={v ? `/quotes?status=${v}` : "/quotes"} className={`btn btn-sm ${(f.status ?? "") === v ? "btn-primary" : "btn-secondary"}`}>{l}</Link>)}
      </nav>
      {quotes.length === 0 ? <Empty title="No quotes here">Open an assessed job and choose “Get contractor quotes”.</Empty> : (
        <>
        {/* Phones: one card per quote */}
        <ul className="space-y-3 md:hidden" data-testid="quote-cards">
          {quotes.map((q) => (
            <li key={q.id} className="card !p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0"><Link className="link font-bold" href={`/quotes/${q.id}`}>{q.contractor?.name}</Link>
                  <span className="block text-xs text-gray-600">{q.number}{q.version > 1 ? ` v${q.version}` : ""}{q.validUntil ? ` · valid until ${fmtDate(q.validUntil)}` : ""}</span></span>
                <span className="whitespace-nowrap text-lg font-extrabold tabular-nums">{formatZar(q.totalCents)}</span>
              </div>
              <p className="mt-2 text-sm"><Link className="link" href={`/jobs/${q.job.id}`}>{q.job.reference}</Link> · {q.job.title}</p>
              <p className="text-xs text-gray-600">{q.job.site.name}</p>
              <div className="mt-2 flex flex-wrap gap-2"><QuotePill status={q.status} /><StatusBadge status={q.job.status} /></div>
            </li>
          ))}
        </ul>
        <div className="card hidden overflow-x-auto p-0 md:block">
          <table className="w-full">
            <thead className="border-b border-gray-300 bg-gray-50"><tr><th className="th">Contractor</th><th className="th">Job</th><th className="th">Site</th><th className="th">Quote</th><th className="th">Job status</th><th className="th text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-200">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="td font-bold"><Link className="link" href={`/quotes/${q.id}`}>{q.contractor?.name}</Link><span className="block text-xs font-normal text-gray-600">{q.number}{q.version > 1 ? ` v${q.version}` : ""}{q.validUntil ? ` · valid until ${fmtDate(q.validUntil)}` : ""}</span></td>
                  <td className="td"><Link className="link" href={`/jobs/${q.job.id}`}>{q.job.reference}</Link><span className="block text-gray-600">{q.job.title}</span></td>
                  <td className="td">{q.job.site.name}</td>
                  <td className="td"><QuotePill status={q.status} /></td>
                  <td className="td"><StatusBadge status={q.job.status} /></td>
                  <td className="td whitespace-nowrap text-right font-bold tabular-nums">{formatZar(q.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}
