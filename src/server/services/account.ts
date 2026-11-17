/**
 * Account recovery and email verification (user-level, not tenant data).
 * - Tokens: 256-bit random, only SHA-256 stored, single use (guarded claim), short expiry.
 * - Password reset never reveals whether an email is registered (same response, same work either way).
 * - Completing a reset revokes every session and proves email ownership.
 * - Unverified accounts can use the app but cannot send email to other people (invitations, customer links),
 *   which stops the product being used to spam from unverified sign-ups.
 */
import type { AuthTokenPurpose } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, conflict, notFound } from "@/lib/errors";
import { hashToken, newToken } from "@/lib/tokens";
import { createSession, emailSchema, hashPassword } from "../auth";
import type { Ctx } from "../permissions";
import { queueEmail } from "./notifications";

export const RESET_MINUTES = 60;
export const VERIFY_HOURS = 48;
const appUrl = () => process.env.APP_URL ?? "";

async function issue(tx: Tx, userId: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<string> {
  // Only the newest token of each purpose works.
  await tx.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  const token = newToken();
  await tx.authToken.create({ data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

async function claim(tx: Tx, token: string, purpose: AuthTokenPurpose) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const t = await tx.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) return null;
  const r = await tx.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return r.count === 1 ? t : null;
}

export async function sendVerificationEmail(tx: Tx, user: { id: string; email: string; name: string }) {
  const token = await issue(tx, user.id, "EMAIL_VERIFY", VERIFY_HOURS * 3_600_000);
  await queueEmail(tx, {
    orgId: null, to: user.email, subject: "Confirm your email address for FixRelay", dedupeKey: `verify:${hashToken(token)}`,
    body: `Hi ${user.name},\n\nPlease confirm this is your email address so you can invite your team and send quotes to customers:\n${appUrl()}/verify-email/${token}\n\nThe link expires in ${VERIFY_HOURS} hours. If you did not create a FixRelay account, you can ignore this email.`,
  });
}

export async function resendVerification(ctx: Ctx) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (user.emailVerifiedAt) throw conflict("Your email address is already confirmed.");
  await prisma.$transaction((tx) => sendVerificationEmail(tx, user));
}

export async function verifyEmail(token: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const t = await claim(tx, token, "EMAIL_VERIFY");
    if (!t) return false;
    await tx.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
    return true;
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const e = emailSchema.safeParse(email);
  if (!e.success) return; // same outcome as an unknown address
  const user = await prisma.user.findUnique({ where: { email: e.data } });
  if (!user) return;
  await prisma.$transaction(async (tx) => {
    const token = await issue(tx, user.id, "PASSWORD_RESET", RESET_MINUTES * 60_000);
    await queueEmail(tx, {
      orgId: null, to: user.email, subject: "Reset your FixRelay password", dedupeKey: `reset:${hashToken(token)}`,
      body: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your FixRelay password. Choose a new password here:\n${appUrl()}/reset-password/${token}\n\nThe link works once and expires in ${RESET_MINUTES} minutes. If you did not ask for this, ignore this email: your password has not changed.`,
    });
  });
}

export async function isResetTokenValid(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  return !!t && t.purpose === "PASSWORD_RESET" && !t.usedAt && t.expiresAt > new Date();
}

/** Set a new password from a reset link. Signs out every device, then signs this browser in. Returns a session token. */
export async function resetPassword(token: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password); // validates length first
  return prisma.$transaction(async (tx) => {
    const t = await claim(tx, token, "PASSWORD_RESET");
    if (!t) throw notFound("This reset link has expired or was already used. Please ask for a new one.");
    const user = await tx.user.update({
      where: { id: t.userId }, data: { passwordHash, emailVerifiedAt: undefined },
    });
    if (!user.emailVerifiedAt) await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.authToken.updateMany({ where: { userId: user.id, purpose: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
    await queueEmail(tx, {
      orgId: null, to: user.email, subject: "Your FixRelay password was changed", dedupeKey: `pwchanged:${t.id}`,
      body: `Hi ${user.name},\n\nYour FixRelay password was just changed and all devices were signed out. If this was not you, reset your password immediately and contact your administrator.`,
    });
    return createSession(tx, user.id);
  });
}

/** Outward-facing email (invitations, customer review links) needs a confirmed address. */
export function requireVerifiedEmail(ctx: Ctx) {
  if (!ctx.emailVerified && !ctx.support)
    throw new AppError("FORBIDDEN", "Please confirm your email address first. Use the link we emailed you, or resend it from the banner at the top of the page.");
}
