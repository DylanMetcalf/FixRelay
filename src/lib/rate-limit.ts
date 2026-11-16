import { AppError } from "./errors";

/**
 * Fixed-window in-memory rate limiter. Adequate for a single app instance.
 * LIMITATION: not shared across instances — replace with a shared store before scaling out (see SECURITY.md).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): void {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  if (++b.count > max) throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
}

export const resetRateLimits = () => buckets.clear();
