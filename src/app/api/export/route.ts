import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { exportClient, exportCompany } from "@/server/services/export";

/** GET /api/export (whole company, owner) or /api/export?client=<id> (one customer, manager). Downloads JSON. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.ctx || s.ctx.support) return new NextResponse("Not found", { status: 404 });
  const client = new URL(req.url).searchParams.get("client");
  try {
    await rateLimit(`export:${s.user.id}`, 10, 60 * 60_000);
    const data = client ? await exportClient(s.ctx, client) : await exportCompany(s.ctx);
    const name = `fixrelay-${client ? "customer" : "company"}-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.code === "FORBIDDEN" ? 403 : e.code === "RATE_LIMITED" ? 429 : 404 });
    console.error(e);
    return new NextResponse("Export failed", { status: 500 });
  }
}
