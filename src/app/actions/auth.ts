"use server";
import { rateLimit } from "@/lib/rate-limit";
import * as auth from "@/server/auth";
import { createDemoWorkspace } from "@/server/services/demo";
import { markAllRead } from "@/server/services/notifications";
import * as account from "@/server/services/account";
import * as orgs from "@/server/services/orgs";
import { invalid } from "@/lib/errors";
import { type ActionState, run, str } from "../_lib/action";
import { clientIp, requireSession, sessionToken, setSessionCookie } from "../_lib/session";

export async function loginAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    await rateLimit(`login:ip:${ip}`, 20, 10 * 60_000);
    await rateLimit(`login:email:${str(fd, "email").toLowerCase()}`, 8, 10 * 60_000);
    const previous = await sessionToken();
    await setSessionCookie(await auth.login(str(fd, "email"), str(fd, "password")));
    if (previous) await auth.logout(previous); // never keep a session from before sign-in
    return { redirect: "/dashboard" };
  });
}

export async function registerAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await rateLimit(`register:ip:${await clientIp()}`, 10, 60 * 60_000);
    const r = await orgs.registerCompany({ name: str(fd, "name"), companyName: str(fd, "companyName"), email: str(fd, "email"), password: str(fd, "password") });
    await setSessionCookie(r.token);
    return { redirect: "/dashboard" };
  });
}

export async function acceptInviteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await rateLimit(`invite:ip:${await clientIp()}`, 20, 10 * 60_000);
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

export async function forgotPasswordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    await rateLimit(`forgot:ip:${ip}`, 10, 60 * 60_000);
    await rateLimit(`forgot:email:${str(fd, "email").trim().toLowerCase()}`, 3, 60 * 60_000);
    await account.requestPasswordReset(str(fd, "email"));
    // Identical response whether or not the address is registered.
    return { ok: "If that email address has a FixRelay account, a reset link is on its way. Check your inbox (and spam folder)." , data: { sent: "1" } };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await rateLimit(`reset:ip:${await clientIp()}`, 20, 60 * 60_000);
    if (str(fd, "password") !== str(fd, "confirm")) throw invalid("The two passwords do not match.");
    await setSessionCookie(await account.resetPassword(str(fd, "token"), str(fd, "password")));
    return { redirect: "/dashboard" };
  });
}

export async function resendVerificationAction(_: ActionState, _fd: FormData) {
  return run(async () => {
    const s = await requireSession();
    await rateLimit(`verify:user:${s.user.id}`, 5, 60 * 60_000);
    await account.resendVerification(s.ctx);
    return { ok: `We sent a new confirmation link to ${s.user.email}.`, data: { sent: "1" } };
  });
}
