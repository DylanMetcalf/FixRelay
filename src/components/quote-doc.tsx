import { formatVatRate, formatZar } from "@/lib/money";
import { fmtDate } from "./ui";

interface Line { id: string; kind: string; description: string; quantity: { toString(): string } | string; unitPriceCents: number; lineTotalCents: number; taxable: boolean }
export interface QuoteDocData {
  number: string; version: number; kind: string; scope: string; terms: string; validUntil: Date | null;
  vatRateBps: number; subtotalCents: number; vatCents: number; totalCents: number; lines: Line[];
}

/** Read-only rendering of a quotation, shared by the staff view and the public customer review page. */
export function QuoteDocument({ q }: { q: QuoteDocData }) {
  return (
    <div data-testid="quote-doc">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-extrabold">Quotation {q.number} <span className="text-sm font-semibold text-gray-600">version {q.version}{q.kind === "VARIATION" ? " · additional work" : ""}</span></p>
        <p className="text-sm">Valid until <strong>{fmtDate(q.validUntil)}</strong></p>
      </div>
      <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-600">Scope of work</h3>
      <p className="whitespace-pre-line text-sm">{q.scope || "—"}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b-2 border-gray-800 text-left text-xs uppercase text-gray-600"><th className="py-1">Item</th><th className="px-2 text-right">Qty</th><th className="px-2 text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-200 align-top">
                <td className="py-1.5"><span className="text-xs font-bold text-gray-600">{l.kind[0] + l.kind.slice(1).toLowerCase()}</span><br />{l.description}{q.vatRateBps > 0 && !l.taxable && <span className="text-xs text-gray-600"> (no VAT)</span>}</td>
                <td className="px-2 text-right tabular-nums">{Number(l.quantity.toString())}</td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums">{formatZar(l.unitPriceCents)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{formatZar(l.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-3 max-w-xs space-y-1 text-sm tabular-nums">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatZar(q.subtotalCents)}</dd></div>
        {q.vatRateBps > 0 ? <div className="flex justify-between"><dt>VAT ({formatVatRate(q.vatRateBps)})</dt><dd>{formatZar(q.vatCents)}</dd></div>
          : <div className="flex justify-between text-gray-600"><dt>VAT</dt><dd>Not applicable</dd></div>}
        <div className="flex justify-between border-t-2 border-gray-800 pt-1 text-base font-extrabold"><dt>Total</dt><dd data-testid="quote-total">{formatZar(q.totalCents)}</dd></div>
      </dl>
      {q.terms && <><h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-600">Terms and conditions</h3><p className="whitespace-pre-line text-xs text-gray-700">{q.terms}</p></>}
    </div>
  );
}
