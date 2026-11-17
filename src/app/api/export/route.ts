import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { exportCompany } from "@/server/services/export";

/** GET /api/export: everything the organisation holds (owner). Downloads JSON. */
export async function GET() {
  const s = await getSession();
  if (!s?.ctx || s.ctx.support) return new NextResponse("Not found", { status: 404 });

  try {
    await rateLimit(`export:${s.user.id}`, 10, 60 * 60_000);
    const data = await exportCompany(s.ctx);
    const name = `fixrelay-company-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.code === "FORBIDDEN" ? 403 : e.code === "RATE_LIMITED" ? 429 : 404 });
    console.error(e);
    return new NextResponse("Export failed", { status: 500 });
  }
}
