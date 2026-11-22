"use server";
import { rateLimit } from "@/lib/rate-limit";
import * as auth from "@/server/auth";
import { createDemoWorkspace, resetDemoWorkspace } from "@/server/services/demo";
import { markAllRead } from "@/server/services/notifications";
import * as account from "@/server/services/account";
import * as orgs from "@/server/services/orgs";
import * as registration from "@/server/services/registration";
import { invalid } from "@/lib/errors";
import { type ActionState, run, str } from "../_lib/action";
import { clientIp, getSession, requireSession, sessionToken, setSessionCookie } from "../_lib/session";

export async function loginAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    await rateLimit(`login:ip:${ip}`, 20, 10 * 60_000);
    await rateLimit(`login:email:${str(fd, "email").toLowerCase()}`, 8, 10 * 60_000);
    const previous = await sessionToken();
    const token = await auth.login(str(fd, "email"), str(fd, "password"));
    await setSessionCookie(token);
    if (previous) await auth.logout(previous); // never keep a session from before sign-in
    const next = str(fd, "next");
    const view = await auth.loadSession(token);
    if (!next && view?.user.isPlatformAdmin && !view.ctx) return { redirect: "/platform" }; // the platform owner's home
    // Only same-site paths (e.g. from a QR code); never an external URL.
    return { redirect: /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) ? next : "/dashboard" };
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
    return { ok: "If that email address has a Resultra account, a reset link is on its way. Check your inbox (and spam folder)." , data: { sent: "1" } };
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
    const s = await getSession(); // also for people still waiting for approval (no company yet)
    if (!s) throw invalid("Please sign in again.");
    await rateLimit(`verify:user:${s.user.id}`, 5, 60 * 60_000);
    await account.resendVerification({ userId: s.user.id });
    return { ok: `We sent a new confirmation link to ${s.user.email}.`, data: { sent: "1" } };
  });
}

/** Employee asks to join with a site registration code (public, rate limited). */
export async function joinWithCodeAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ip = await clientIp();
    await rateLimit(`join:ip:${ip}`, 8, 60 * 60_000);
    const photo = fd.get("photo");
    const bytes = photo instanceof File && photo.size > 0 ? Buffer.from(await photo.arrayBuffer()) : null;
    const r = await registration.registerWithCode({
      code: str(fd, "code"), name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password"),
      departmentId: str(fd, "departmentId") || null, jobTitle: str(fd, "jobTitle"), phone: str(fd, "phone"),
    }, bytes);
    const previous = await sessionToken();
    await setSessionCookie(r.token);
    if (previous) await auth.logout(previous);
    return { redirect: "/no-access" };
  });
}

export async function updateProfileAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const s = await requireSession();
    const photo = fd.get("photo");
    const bytes = photo instanceof File && photo.size > 0 ? Buffer.from(await photo.arrayBuffer()) : null;
    await registration.updateMyProfile(s.ctx, { name: str(fd, "name"), jobTitle: str(fd, "jobTitle"), phone: str(fd, "phone") }, bytes);
    return { ok: "Your details were saved." };
  });
}

/** Demo only: view as a sample person, or return to yourself. */
export async function viewAsAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await auth.setViewAs((await sessionToken())!, str(fd, "personaId") || null);
    return { redirect: "/dashboard" };
  });
}

export async function resetDemoAction(_: ActionState, _fd: FormData) {
  return run(async () => {
    const s = await getSession();
    if (!s) throw invalid("Please sign in again.");
    const orgId = await resetDemoWorkspace(s.user);
    await auth.switchWorkspace((await sessionToken())!, orgId);
    return { redirect: "/dashboard", ok: "Demo data reset." };
  });
}
