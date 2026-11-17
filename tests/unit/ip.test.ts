import { describe, expect, it } from "vitest";
import { ipFromHeaders } from "@/app/_lib/session";

const h = (xff?: string) => ({ get: (n: string) => (n === "x-forwarded-for" ? (xff ?? null) : null) });

describe("client IP from X-Forwarded-For", () => {
  it("ignores spoofed entries added by the client and trusts only the proxy hops", () => {
    expect(ipFromHeaders(h("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9"); // attacker sent 6.6.6.6
    expect(ipFromHeaders(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
    expect(ipFromHeaders(h("203.0.113.9"), 3)).toBe("203.0.113.9");
    expect(ipFromHeaders(h(), 1)).toBe("direct");
    expect(ipFromHeaders(h("1.2.3.4"), 0)).toBe("direct"); // no proxy trusted
  });
});
