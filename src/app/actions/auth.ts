"use server";
import { rateLimit } from "@/lib/rate-limit";
import * as auth from "@/server/auth";
import { createDemoWorkspace } from "@/server/services/demo";
import { markAllRead } from "@/server/services/notifications";
import * as orgs from "@/server/services/orgs";
import { type ActionState, run, str } from "../_lib/action";
import { clientIp, requireSession, sessionToken, setSessionCookie } from "../_lib/session";

export async function loginAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    rateLimit(`login:ip:${ip}`, 20, 10 * 60_000);
    rateLimit(`login:email:${str(fd, "email").toLowerCase()}`, 8, 10 * 60_000);
    await setSessionCookie(await auth.login(str(fd, "email"), str(fd, "password")));
    return { redirect: "/dashboard" };
  });
}

export async function registerAction(_: ActionState, fd: FormData) {
  return run(async () => {
    rateLimit(`register:ip:${await clientIp()}`, 10, 60 * 60_000);
    const r = await orgs.registerCompany({ name: str(fd, "name"), companyName: str(fd, "companyName"), email: str(fd, "email"), password: str(fd, "password") });
    await setSessionCookie(r.token);
    return { redirect: "/dashboard" };
  });
}

export async function acceptInviteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    rateLimit(`invite:ip:${await clientIp()}`, 20, 10 * 60_000);
    const r = await orgs.acceptInvitation(str(fd, "token"), { name: str(fd, "name"), password: str(fd, "password") });
    await setSessionCookie(r.token);
    return { redirect: "/dashboard" };
  });
}

export async function switchWorkspaceAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const t = await sessionToken();
    if (t) await auth.switchWorkspace(t, str(fd, "orgId") || null);
    return { redirect: str(fd, "orgId") ? "/dashboard" : "/platform" };
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const s = await requireSession();
    await auth.changePassword(s.user.id, str(fd, "current"), str(fd, "next"), (await sessionToken())!);
    return { ok: "Password changed. Other devices have been signed out." };
  });
}

export async function createDemoAction(_: ActionState, _fd: FormData) {
  return run(async () => {
    const s = await requireSession();
    const orgId = await createDemoWorkspace(s.user);
    await auth.switchWorkspace((await sessionToken())!, orgId);
    return { redirect: "/dashboard" };
  });
}

export async function markReadAction(_: ActionState, _fd: FormData) {
  return run(async () => {
    await markAllRead((await requireSession()).ctx);
    return { ok: "All caught up." };
  });
}
