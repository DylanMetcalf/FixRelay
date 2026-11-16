"use client";
import { useMemo, useState } from "react";
import type { ActionState } from "@/app/_lib/action";
import { computeTotals, formatVatRate, formatZar, lineTotalCents, parseQuantityMilli, parseRandToCents } from "@/lib/money";
import { ShareLink } from "./client";
import { Form, Submit } from "./form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A form whose successful result contains a one-time link (review link or invitation). */
export function LinkForm({ action, hidden, children, submit, shareLabel }: { action: Action; hidden?: Record<string, string>; children: React.ReactNode; submit: string; shareLabel: string }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Form action={action} hidden={hidden} onOk={(d) => setLink(d?.link ?? null)}>{children}<Submit>{submit}</Submit></Form>
      {link && <ShareLink link={link} label={shareLabel} />}
    </div>
  );
}

interface Site { id: string; name: string; locations: { id: string; name: string }[]; assets: { id: string; name: string; reference: string; locationId: string | null }[] }
interface ClientOpt { id: string; name: string; sites: Site[] }

/** Customer → site → location/asset pickers that narrow as you choose. */
export function RequestPlaceFields({ clients }: { clients: ClientOpt[] }) {
  const [clientId, setClientId] = useState(clients.length === 1 ? clients[0]!.id : "");
  const sites = clients.find((c) => c.id === clientId)?.sites ?? [];
  const [siteId, setSiteId] = useState("");
  const site = sites.find((s) => s.id === siteId) ?? (sites.length === 1 ? sites[0] : undefined);
  return (
    <>
      <div>
        <label className="label" htmlFor="clientId">Customer <span className="text-red-700">*</span></label>
        <select id="clientId" name="clientId" className="input" required value={clientId} onChange={(e) => { setClientId(e.target.value); setSiteId(""); }}>
          {clients.length !== 1 && <option value="">Choose a customer…</option>}
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="siteId">Site <span className="text-red-700">*</span></label>
        <select id="siteId" name="siteId" className="input" required value={site?.id ?? ""} onChange={(e) => setSiteId(e.target.value)} disabled={!clientId}>
          {sites.length !== 1 && <option value="">{clientId ? (sites.length ? "Choose a site…" : "This customer has no sites yet") : "Choose a customer first"}</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {site && site.locations.length > 0 && (
        <div>
          <label className="label" htmlFor="locationId">Specific location</label>
          <select id="locationId" name="locationId" className="input" defaultValue=""><option value="">Not specified</option>{site.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </div>
      )}
      {site && site.assets.length > 0 && (
        <div>
          <label className="label" htmlFor="assetId">Equipment / asset</label>
          <select id="assetId" name="assetId" className="input" defaultValue=""><option value="">Not about a specific asset</option>{site.assets.map((a) => <option key={a.id} value={a.id}>{a.reference} – {a.name}</option>)}</select>
        </div>
      )}
    </>
  );
}

export interface EditorLine { kind: "LABOUR" | "MATERIAL" | "OTHER"; description: string; quantity: string; unitPrice: string; taxable: boolean }

/** Quote line-item editor. Totals shown here use the SAME functions the server uses; the server recomputes on save. */
export function QuoteEditor({ action, quoteId, jobId, initial, scope, terms, validUntil, vatRateBps }: {
  action: Action; quoteId: string; jobId: string; initial: EditorLine[]; scope: string; terms: string; validUntil: string; vatRateBps: number;
}) {
  const blank: EditorLine = { kind: "LABOUR", description: "", quantity: "1", unitPrice: "", taxable: true };
  const [lines, setLines] = useState<EditorLine[]>(initial.length ? initial : [blank]);
  const set = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const calc = useMemo(() => {
    const totals = lines.map((l) => { try { return lineTotalCents(parseQuantityMilli(l.quantity), parseRandToCents(l.unitPrice || "0")); } catch { return null; } });
    let sum = null as ReturnType<typeof computeTotals> | null;
    try { sum = computeTotals(lines.map((l, i) => ({ lineTotalCents: totals[i] ?? 0, taxable: l.taxable })), vatRateBps); } catch { /* shown as invalid */ }
    return { totals, sum };
  }, [lines, vatRateBps]);
  return (
    <Form action={action} hidden={{ quoteId, jobId, lines: JSON.stringify(lines) }} className="space-y-4">
      <div><label className="label" htmlFor="scope">Scope of work <span className="text-red-700">*</span></label><textarea id="scope" name="scope" rows={3} className="input" defaultValue={scope} /></div>
      <fieldset>
        <legend className="label">Line items</legend>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 rounded-md border border-gray-300 bg-gray-50 p-2 md:grid-cols-12" data-testid="quote-line">
              <select aria-label="Type" className="input col-span-2 md:col-span-2" value={l.kind} onChange={(e) => set(i, { kind: e.target.value as EditorLine["kind"] })}>
                <option value="LABOUR">Labour</option><option value="MATERIAL">Material</option><option value="OTHER">Other</option>
              </select>
              <input aria-label="Description" placeholder="Description" className="input col-span-4 md:col-span-4" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
              <input aria-label="Quantity" inputMode="decimal" placeholder="Qty" className="input col-span-2 md:col-span-1" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
              <input aria-label="Unit price in rand" inputMode="decimal" placeholder="Unit price (R)" className="input col-span-2 md:col-span-2" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />
              <div className="col-span-2 flex items-center justify-end text-sm font-bold tabular-nums md:col-span-2">{calc.totals[i] == null ? <span className="text-red-700">Check values</span> : formatZar(calc.totals[i]!)}</div>
              <div className="col-span-6 flex items-center justify-between md:col-span-1 md:justify-end">
                {vatRateBps > 0 && <label className="flex items-center gap-1 text-xs font-semibold md:hidden"><input type="checkbox" checked={l.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} />VAT</label>}
                <button type="button" aria-label={`Remove line ${i + 1}`} className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
              </div>
              {vatRateBps > 0 && <label className="col-span-12 hidden items-center gap-2 text-xs font-semibold md:flex"><input type="checkbox" checked={l.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} />VAT applies to this line</label>}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setLines((ls) => [...ls, blank])}>+ Add line</button>
      </fieldset>
      <dl className="ml-auto max-w-xs space-y-1 text-sm tabular-nums" data-testid="quote-totals">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{calc.sum ? formatZar(calc.sum.subtotalCents) : "—"}</dd></div>
        <div className="flex justify-between"><dt>{vatRateBps > 0 ? `VAT (${formatVatRate(vatRateBps)})` : "VAT (not registered)"}</dt><dd>{calc.sum ? formatZar(calc.sum.vatCents) : "—"}</dd></div>
        <div className="flex justify-between border-t border-gray-400 pt-1 text-base font-extrabold"><dt>Total</dt><dd>{calc.sum ? formatZar(calc.sum.totalCents) : "—"}</dd></div>
      </dl>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label" htmlFor="validUntil">Valid until</label><input id="validUntil" type="date" name="validUntil" className="input" defaultValue={validUntil} /></div>
        <div><label className="label" htmlFor="files">Attach documents (optional)</label><input id="files" type="file" name="files" multiple accept="image/*,application/pdf" className="input" /></div>
      </div>
      <div><label className="label" htmlFor="terms">Terms and conditions</label><textarea id="terms" name="terms" rows={3} className="input" defaultValue={terms} /></div>
      <div className="flex flex-wrap gap-2">
        <button name="intent" value="save" className="btn btn-secondary">Save draft</button>
        <button name="intent" value="submit" className="btn btn-primary"
          onClick={(e) => { if (!window.confirm("Submit this quote for approval? It can no longer be edited afterwards (you can create a revision).")) e.preventDefault(); }}>
          Save and submit for approval
        </button>
      </div>
    </Form>
  );
}
