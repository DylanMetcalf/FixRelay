import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadSession, SESSION_DAYS, type SessionView } from "@/server/auth";
import { can, type Ctx, type Permission } from "@/server/permissions";

// "__Host-" prefix (production): the browser only accepts it over HTTPS, for this exact host, path "/".
export const COOKIE = process.env.NODE_ENV === "production" ? "__Host-fr_session" : "fr_session";

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
  if (!s) redirect(await loginUrl());
  if (!s.ctx || !s.org) redirect(s.user.isPlatformAdmin ? "/platform" : "/no-access");
  return s as SessionView & { ctx: Ctx; org: NonNullable<SessionView["org"]> };
}
/** /login, with ?next= pointing back to the page that was asked for (only same-site paths). */
export async function loginUrl() {
  const path = (await headers()).get("x-resultra-path") ?? "";
  return /^\/(?!\/)[\w\-/?=&%.]*$/.test(path) && !path.startsWith("/login") ? `/login?next=${encodeURIComponent(path)}` : "/login";
}

export const requireCtx = async () => (await requireSession()).ctx;

/** Page-level guard: sends users without the permission to a clear "no permission" screen. */
export async function requirePage(perm: Permission) {
  const s = await requireSession();
  if (!can(s.ctx, perm)) redirect("/forbidden");
  return s;
}

/**
 * The client's IP for rate limiting and decision records. X-Forwarded-For is client-controlled except for the
 * entries appended by YOUR proxies, so we take the address TRUSTED_PROXY_HOPS from the right (default 1 = one
 * reverse proxy / load balancer, the usual PaaS setup). Taking the leftmost entry would let anyone bypass rate
 * limits by sending a fake header.
 */
export async function clientIp(): Promise<string> {
  return ipFromHeaders(await headers(), Number(process.env.TRUSTED_PROXY_HOPS ?? 1));
}

export function ipFromHeaders(h: { get(name: string): string | null }, hops: number): string {
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = hops > 0 && chain.length > 0 ? chain[Math.max(0, chain.length - hops)] : undefined;
  return (ip ?? "direct").slice(0, 60);
}
