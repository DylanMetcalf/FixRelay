/**
 * Unexpected server errors are written to ErrorLog for the platform console (and to stdout for the host's logs).
 * Only the message and IDs are stored: no request bodies, tokens or personal details.
 */
import { prisma } from "@/lib/db";

export async function logError(source: string, e: unknown, meta: { path?: string; orgId?: string | null; userId?: string | null } = {}) {
  const message = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
  console.error(`[${source} error]`, e);
  try {
    await prisma.errorLog.create({ data: { source: source.slice(0, 40), message, path: (meta.path ?? "").slice(0, 200), orgId: meta.orgId ?? null, userId: meta.userId ?? null } });
  } catch { /* logging must never break the request */ }
}
