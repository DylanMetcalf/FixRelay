/**
 * Money rules (see DATABASE.md):
 * - All amounts are integer cents. No floats are used in calculations.
 * - Quantities have up to 3 decimals and are handled as integer thousandths.
 * - Line total = round_half_up(quantity × unit price) to the cent.
 * - VAT = round_half_up(sum of taxable line totals × rate), computed once on the quote, not per line.
 */
import { invalid } from "./errors";

export const MAX_CENTS = 2_000_000_000; // fits a 32-bit int column

/** "12.5" -> 12500 thousandths. Rejects more than 3 decimals, negatives and junk. */
export function parseQuantityMilli(input: string): bigint {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(s)) throw invalid(`Invalid quantity "${input}". Use up to 3 decimals.`);
  const [whole = "0", frac = ""] = s.split(".");
  const milli = BigInt(whole) * 1000n + BigInt(frac.padEnd(3, "0"));
  if (milli <= 0n) throw invalid("Quantity must be greater than zero.");
  return milli;
}

/** "1 250.50" / "R1,250.50" -> 125050 cents. Rejects more than 2 decimals. */
export function parseRandToCents(input: string): number {
  let s = input.trim().replace(/^R\s*/i, "").replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, ""); // 1,250.50
  else s = s.replace(",", "."); // 1250,50
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw invalid(`Invalid amount "${input}".`);
  const [whole = "0", frac = ""] = s.split(".");
  return Number(BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0")));
}

function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

export function lineTotalCents(quantityMilli: bigint, unitPriceCents: number): number {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) throw invalid("Invalid unit price.");
  const total = divRoundHalfUp(quantityMilli * BigInt(unitPriceCents), 1000n);
  if (total > BigInt(MAX_CENTS)) throw invalid("Line total is too large.");
  return Number(total);
}

export interface TotalsInput {
  lineTotalCents: number;
  taxable: boolean;
}

export function computeTotals(lines: TotalsInput[], vatRateBps: number) {
  let subtotal = 0n;
  let taxableBase = 0n;
  for (const l of lines) {
    subtotal += BigInt(l.lineTotalCents);
    if (l.taxable) taxableBase += BigInt(l.lineTotalCents);
  }
  const vat = vatRateBps > 0 ? divRoundHalfUp(taxableBase * BigInt(vatRateBps), 10000n) : 0n;
  const total = subtotal + vat;
  if (total > BigInt(MAX_CENTS)) throw invalid("Quote total is too large.");
  return { subtotalCents: Number(subtotal), vatCents: Number(vat), totalCents: Number(total) };
}

/** 125050 -> "R 1 250.50" (South African convention: space thousands separator). */
export function formatZar(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}R ${whole}.${(abs % 100).toString().padStart(2, "0")}`;
}

export const formatVatRate = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
