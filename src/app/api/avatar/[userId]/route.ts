import { getSession } from "@/app/_lib/session";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Profile photos: only for signed-in members of the same company (pending requests included, for administrators). */
export async function GET(_: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const s = await getSession();
  if (!s?.ctx || !/^[0-9a-f-]{36}$/.test(userId)) return new Response("Not found", { status: 404 });
  const same = await prisma.membership.findFirst({ where: { orgId: s.ctx.orgId, userId, OR: [{ active: true }, { status: "PENDING" }] } });
  const user = same ? await prisma.user.findUnique({ where: { id: userId }, select: { photoKey: true } }) : null;
  if (!user?.photoKey) return new Response("Not found", { status: 404 });
  const bytes = await storage().get(user.photoKey).catch(() => null);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
