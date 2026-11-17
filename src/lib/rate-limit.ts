import { prisma } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter.
 * - "db" (default): one atomic UPSERT in Postgres, so the limit is shared by every app instance.
 * - "memory": per-process map, used only when RATE_LIMIT_STORE=memory (single instance / local dev).
 * Expired rows are removed by the worker (purgeExpiredRateLimits).
 */
const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, windowMs: number, now: number): number {
  const b = memory.get(key);
  if (!b || b.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    return 1;
  }
  return ++b.count;
}

async function dbHit(key: string, windowMs: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}))
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count"`;
  return rows[0]!.count;
}

export async function rateLimit(key: string, max: number, windowMs: number): Promise<void> {
  const k = key.slice(0, 300);
  const count = process.env.RATE_LIMIT_STORE === "memory" ? memoryHit(k, windowMs, Date.now()) : await dbHit(k, windowMs);
  if (count > max) throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
}

export const purgeExpiredRateLimits = () => prisma.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } });
export const resetRateLimits = () => memory.clear();
