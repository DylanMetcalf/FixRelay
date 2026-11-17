/**
 * Authentication: email + password, opaque server-side sessions.
 * - Passwords hashed with bcrypt (bcryptjs). Sessions are random 256-bit tokens; only SHA-256 is stored.
 * - Sessions are revocable server-side and membership is re-checked on every request (loadSession),
 *   so deactivating a member takes effect immediately.
 * This module has no Next.js imports so it can be tested directly. Cookie handling lives in app/_lib/session.ts.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { AppError, invalid } from "@/lib/errors";
import { hashToken, newToken } from "@/lib/tokens";
import type { Ctx } from "./permissions";
import { subscriptionState, type SubscriptionView } from "./services/billing";

const COST = Number(process.env.BCRYPT_COST ?? 12);
export const SESSION_DAYS = 30;
// Pre-computed hash so unknown-email logins take as long as wrong-password logins.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", COST);

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(72, "Password must be at most 72 characters.");

export async function hashPassword(password: string): Promise<string> {
  const p = passwordSchema.safeParse(password);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  return bcrypt.hash(password, COST);
}

export async function createSession(db: Db, userId: string, activeOrgId: string | null = null): Promise<string> {
  const token = newToken();
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeOrgId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function login(email: string, password: string): Promise<string> {
  const e = emailSchema.safeParse(email);
  const user = e.success ? await prisma.user.findUnique({ where: { email: e.data } }) : null;
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError("UNAUTHENTICATED", "Incorrect email or password.");
  return createSession(prisma, user.id);
}

export async function logout(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function changePassword(userId: string, current: string, next: string, keepToken: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw invalid("Current password is incorrect.");
  const passwordHash = await hashPassword(next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    // Revoke every other session.
    prisma.session.deleteMany({ where: { userId, NOT: { tokenHash: hashToken(keepToken) } } }),
  ]);
}

export interface SessionView {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; emailVerified: boolean };
  /** null when the user has no active membership (e.g. platform admin only, or access revoked). */
  ctx: Ctx | null;
  org: {
    id: string; name: string; slug: string; isDemo: boolean; brandColour: string;
    logoAttachmentId: string | null; publicReportingEnabled: boolean;
  } | null;
  subscription: SubscriptionView | null;
  workspaces: { orgId: string; name: string; isDemo: boolean }[];
}

/** Resolve a session token into the acting user and tenant context. Returns null if invalid/expired. */
export async function loadSession(token: string | undefined): Promise<SessionView | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            where: { active: true },
            include: { org: { include: { subscription: { include: { plan: true } } } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!s || s.expiresAt < new Date()) return null;
  const { user } = s;
  const base = {
    user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin, emailVerified: !!user.emailVerifiedAt },
    workspaces: user.memberships.map((m) => ({ orgId: m.orgId, name: m.org.name, isDemo: m.org.isDemo })),
  };
  const m = user.memberships.find((x) => x.orgId === s.activeOrgId) ?? (s.activeOrgId ? undefined : user.memberships[0]);

  if (!m && s.activeOrgId && user.isPlatformAdmin) {
    // Support access: only with a live grant from the tenant's owner. Always read-only.
    const grant = await prisma.supportAccessGrant.findFirst({
      where: { orgId: s.activeOrgId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    const org = grant
      ? await prisma.organisation.findUnique({
          where: { id: s.activeOrgId },
          include: { subscription: { include: { plan: true } } },
        })
      : null;
    if (org)
      return {
        ...base,
        org,
        subscription: subscriptionState(org.subscription, org.isDemo),
        ctx: {
          userId: user.id, userName: `${user.name} (platform support)`, userEmail: user.email,
          orgId: org.id, roles: [], siteIds: [], support: true, locked: false, emailVerified: true,
        },
      };
  }
  const membership = m ?? user.memberships[0];
  if (!membership) return { ...base, ctx: null, org: null, subscription: null };
  const sub = subscriptionState(membership.org.subscription, membership.org.isDemo);
  return {
    ...base,
    org: membership.org,
    subscription: sub,
    ctx: {
      userId: user.id, userName: user.name, userEmail: user.email, orgId: membership.orgId,
      roles: membership.roles, siteIds: membership.siteIds, support: false, locked: sub.access === "locked", emailVerified: !!user.emailVerifiedAt,
    },
  };
}

/** Change the session's active company. Only to a company the user belongs to (or, for the platform operator, any — loadSession still demands a live support grant). */
export async function switchWorkspace(token: string, orgId: string | null): Promise<void> {
  const s = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!s) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  if (orgId && !s.user.isPlatformAdmin && !(await prisma.membership.findFirst({ where: { userId: s.userId, orgId, active: true } })))
    throw new AppError("FORBIDDEN", "You do not have access to that workspace.");
  await prisma.session.update({ where: { id: s.id }, data: { activeOrgId: orgId } });
}
