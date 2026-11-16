import { describe, expect, it } from "vitest";
import { computeTotals, formatZar, lineTotalCents, parseQuantityMilli, parseRandToCents } from "@/lib/money";
import { canTransition, nextAction, TRANSITIONS } from "@/server/workflow";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("money", () => {
  it("parses rand amounts exactly", () => {
    expect(parseRandToCents("1250.50")).toBe(125050);
    expect(parseRandToCents("R 1 250,5")).toBe(125050);
    expect(parseRandToCents("1,250.50")).toBe(125050);
    expect(parseRandToCents("0.07")).toBe(7);
    expect(() => parseRandToCents("12.345")).toThrow();
    expect(() => parseRandToCents("-5")).toThrow();
    expect(() => parseRandToCents("abc")).toThrow();
  });
  it("parses quantities to thousandths and rejects junk", () => {
    expect(parseQuantityMilli("2.5")).toBe(2500n);
    expect(parseQuantityMilli("0.001")).toBe(1n);
    expect(() => parseQuantityMilli("0")).toThrow();
    expect(() => parseQuantityMilli("1.2345")).toThrow();
    expect(() => parseQuantityMilli("1e3")).toThrow();
  });
  it("rounds line totals half-up without float error", () => {
    expect(lineTotalCents(2500n, 65000)).toBe(162500);
    expect(lineTotalCents(333n, 1000)).toBe(333); // 0.333 × R10.00
    expect(lineTotalCents(1n, 500)).toBe(1); // 0.5c rounds up
    expect(lineTotalCents(1n, 499)).toBe(0);
    expect(lineTotalCents(1100n, 10)).toBe(11); // 0.1 × 3 style float traps
    expect(lineTotalCents(3000n, 10)).toBe(30);
  });
  it("computes VAT once on the taxable base", () => {
    const t = computeTotals([{ lineTotalCents: 162500, taxable: true }, { lineTotalCents: 123456, taxable: true }, { lineTotalCents: 5000, taxable: false }], 1500);
    expect(t).toEqual({ subtotalCents: 290956, vatCents: 42893, totalCents: 333849 }); // 285956 × 15% = 42893.4
    expect(computeTotals([{ lineTotalCents: 10, taxable: true }], 1500).vatCents).toBe(2); // 1.5 rounds up
    expect(computeTotals([{ lineTotalCents: 99999, taxable: true }], 0)).toEqual({ subtotalCents: 99999, vatCents: 0, totalCents: 99999 });
  });
  it("formats rand", () => {
    expect(formatZar(125050)).toBe("R 1 250.50");
    expect(formatZar(5)).toBe("R 0.05");
    expect(formatZar(123456789)).toBe("R 1 234 567.89");
  });
});

describe("workflow state machine", () => {
  it("allows the primary path", () => {
    const path = ["NEW", "ASSESSING", "ASSESSED", "QUOTING", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS", "AWAITING_VERIFICATION", "VERIFIED", "CLOSED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it("blocks illegal jumps", () => {
    expect(canTransition("NEW", "IN_PROGRESS")).toBe(false);
    expect(canTransition("NEW", "CLOSED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CLOSED")).toBe(false);
    expect(canTransition("AWAITING_APPROVAL", "ASSIGNED")).toBe(false);
    expect(canTransition("CLOSED", "CANCELLED")).toBe(false);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
  it("names the next action and responsible party", () => {
    expect(nextAction({ status: "AWAITING_APPROVAL", customerSignoffRequired: true })).toEqual({ label: "Approve or reject the quote", party: "Customer" });
    expect(nextAction({ status: "AWAITING_VERIFICATION", customerSignoffRequired: false }).party).toBe("Manager");
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and resets after the window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000, 0);
    expect(() => rateLimit("k", 3, 1000, 500)).toThrow(/Too many/);
    expect(() => rateLimit("k", 3, 1000, 1001)).not.toThrow();
  });
});
