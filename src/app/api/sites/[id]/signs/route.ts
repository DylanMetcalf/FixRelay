import { getSession } from "@/app/_lib/session";
import { AppError } from "@/lib/errors";
import { logError } from "@/server/errors";
import { renderQrSigns } from "@/server/pdf/qr-sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/sites/:id/signs[?location=<id>|?siteOnly=1] – printable A4 QR signs (site managers only). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s?.ctx) return new Response("Please sign in.", { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    const { bytes, filename } = await renderQrSigns(s.ctx, id, { locationId: q.get("location"), siteOnly: q.get("siteOnly") === "1" });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    await logError("pdf", e, { path: `/api/sites/${id}/signs`, orgId: s.ctx.orgId, userId: s.ctx.userId });
    return new Response("The signs could not be generated. Please try again.", { status: 500 });
  }
}
