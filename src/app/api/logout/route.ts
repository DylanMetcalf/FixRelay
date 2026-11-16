import { NextResponse } from "next/server";
import { COOKIE, sessionToken } from "@/app/_lib/session";
import { logout } from "@/server/auth";

/** Sign out: deletes the server-side session and the cookie. POST only (SameSite=Lax blocks cross-site use). */
export async function POST(req: Request) {
  const t = await sessionToken();
  if (t) await logout(t);
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(COOKIE);
  return res;
}
