import { getSession } from "@/app/_lib/session";
import { AppError } from "@/lib/errors";
import { logError } from "@/server/errors";
import { DOC_KINDS, renderJobDocument, type JobDocKind } from "@/server/pdf/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/jobs/:id/documents/:kind  (card | completion | history)
 * Signed-in members with access to the job only. `?download=1` saves the file; otherwise it opens in the browser.
 * Responses are never cached: each PDF is a fresh snapshot of the live record.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const s = await getSession();
  if (!s?.ctx) return new Response("Please sign in.", { status: 401 });
  if (!DOC_KINDS.includes(kind as JobDocKind)) return new Response("Not found", { status: 404 });
  try {
    const { bytes, filename } = await renderJobDocument(s.ctx, id, kind as JobDocKind);
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : e.code === "CONFLICT" ? 409 : 400;
      return new Response(e.message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    await logError("pdf", e, { path: `/api/jobs/${id}/documents/${kind}`, orgId: s.ctx.orgId, userId: s.ctx.userId });
    return new Response("The document could not be generated. Please try again.", { status: 500 });
  }
}
