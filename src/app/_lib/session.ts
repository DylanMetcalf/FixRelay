import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadSession, SESSION_DAYS, type SessionView } from "@/server/auth";
import { can, type Ctx, type Permission } from "@/server/permissions";

export const COOKIE = "fr_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86_400,
  });
}
export const clearSessionCookie = async () => (await cookies()).delete(COOKIE);
export const sessionToken = async () => (await cookies()).get(COOKIE)?.value;

/** Loaded once per request. */
export const getSession = cache(async (): Promise<SessionView | null> => loadSession(await sessionToken()));

/** For pages/actions inside the app: a signed-in user with an active company context. */
export async function requireSession(): Promise<SessionView & { ctx: Ctx; org: NonNullable<SessionView["org"]> }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.ctx || !s.org) redirect(s.user.isPlatformAdmin ? "/platform" : "/no-access");
  return s as SessionView & { ctx: Ctx; org: NonNullable<SessionView["org"]> };
}
export const requireCtx = async () => (await requireSession()).ctx;

/** Page-level guard: sends users without the permission to a clear "no permission" screen. */
export async function requirePage(perm: Permission) {
  const s = await requireSession();
  if (!can(s.ctx, perm)) redirect("/forbidden");
  return s;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 60);
}
