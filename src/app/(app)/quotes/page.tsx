import Link from "@/components/link";
import { requirePage } from "@/app/_lib/session";
import { Empty, fmtDate, PageHeader, QuotePill } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { listQuotes } from "@/server/services/quotes";

export const metadata = { title: "Quotes" };

export default async function Quotes({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { ctx } = await requirePage("quote.view");
  const f = await searchParams;
  const quotes = await listQuotes(ctx, f);
  const tabs = [["", "All"], ["DRAFT", "Drafts"], ["SUBMITTED", "Awaiting approval"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]] as const;
  return (
    <>
      <PageHeader title="Quotes" subtitle="Quotations are created from an assessed job." />
      <nav aria-label="Quote status" className="no-print mb-4 flex flex-wrap gap-2">
        {tabs.map(([v, l]) => <Link key={v} href={v ? `/quotes?status=${v}` : "/quotes"} className={`btn btn-sm ${(f.status ?? "") === v ? "btn-primary" : "btn-secondary"}`}>{l}</Link>)}
      </nav>
      {quotes.length === 0 ? <Empty title="No quotes here">Open an assessed job and choose “Prepare quotation”.</Empty> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-gray-300 bg-gray-50"><tr><th className="th">Quote</th><th className="th">Job</th><th className="th">Customer</th><th className="th">Status</th><th className="th">Valid until</th><th className="th text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-200">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="td whitespace-nowrap font-bold"><Link className="link" href={`/quotes/${q.id}`}>{q.number} v{q.version}</Link>{q.kind === "VARIATION" && <span className="block text-xs font-normal text-gray-600">variation</span>}</td>
                  <td className="td"><Link className="link" href={`/jobs/${q.job.id}`}>{q.job.reference}</Link><span className="block text-gray-600">{q.job.title}</span></td>
                  <td className="td">{q.job.client.name}</td>
                  <td className="td"><QuotePill status={q.status} /></td>
                  <td className="td whitespace-nowrap">{fmtDate(q.validUntil)}</td>
                  <td className="td whitespace-nowrap text-right font-bold tabular-nums">{formatZar(q.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
