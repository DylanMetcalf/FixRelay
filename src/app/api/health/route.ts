import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Health for load balancers and monitoring. 200 when the database answers.
 * With ?token=$HEALTH_TOKEN it also returns `emailBacklogMinutes` = age of the oldest undelivered email (alert if it keeps growing: worker down or provider failing).
 */
export async function GET(req: Request) {
  try {
    const token = process.env.HEALTH_TOKEN;
    const detail = !!token && new URL(req.url).searchParams.get("token") === token; // details are not public
    if (!detail) { await prisma.$queryRaw`SELECT 1`; return NextResponse.json({ ok: true }); }
    const [oldest, failed] = await Promise.all([
      prisma.outboxEmail.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.outboxEmail.count({ where: { status: "FAILED", createdAt: { gt: new Date(Date.now() - 86_400_000) } } }),
    ]);
    return NextResponse.json({ ok: true, emailBacklogMinutes: oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 60_000) : 0, emailsFailedLast24h: failed });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
