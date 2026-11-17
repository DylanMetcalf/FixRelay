/**
 * Subscriptions and entitlements. Provider-neutral: no prices and no payment logic live here.
 * A payment provider adapter (see BillingProvider) only needs to call `setSubscription`.
 * Locking a tenant makes it READ-ONLY; it never deletes or hides the customer's records.
 */
import type { Plan, Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { AppError, forbidden } from "@/lib/errors";
import { OPEN_STATUSES } from "../workflow";

export const GRACE_DAYS = 7;
export const TRIAL_DAYS = 14;
const DAY = 86_400_000;

export interface SubscriptionView {
  access: "full" | "grace" | "locked";
  status: SubscriptionStatus | "DEMO" | "NONE";
  planName: string;
  message: string;
  endsAt: Date | null;
}

export function subscriptionState(
  sub: (Subscription & { plan: Plan }) | null | undefined,
  isDemo = false,
  now = new Date(),
): SubscriptionView {
  if (isDemo) return { access: "full", status: "DEMO", planName: "Demo workspace", message: "", endsAt: null };
  if (!sub) return { access: "locked", status: "NONE", planName: "None", message: "No subscription.", endsAt: null };
  const v = (access: SubscriptionView["access"], message: string, endsAt: Date | null): SubscriptionView => ({
    access, status: sub.status, planName: sub.plan.name, message, endsAt,
  });
  const graceFrom = (d: Date) => sub.graceEndsAt ?? new Date(d.getTime() + GRACE_DAYS * DAY);
  switch (sub.status) {
    case "TRIALING": {
      const end = sub.trialEndsAt ?? now;
      if (end > now) return v("full", "Free trial", end);
      const g = graceFrom(end);
      return g > now ? v("grace", "Your trial has ended. Choose a plan to keep working.", g) : v("locked", "Trial ended.", g);
    }
    case "ACTIVE": {
      const end = sub.currentPeriodEnd;
      if (!end || end > now) return v("full", "Active", end);
      const g = graceFrom(end);
      return g > now ? v("grace", "Subscription renewal is overdue.", g) : v("locked", "Subscription expired.", g);
    }
    case "PAST_DUE": {
      const g = sub.graceEndsAt ?? graceFrom(sub.currentPeriodEnd ?? now);
      return g > now ? v("grace", "Payment is overdue.", g) : v("locked", "Payment overdue.", g);
    }
    default:
      return v("locked", sub.status === "SUSPENDED" ? "Account suspended." : "Subscription cancelled.", null);
  }
}

/** Entitlement numbers live in the Plan table, never in code paths. These are only first-run defaults. */
export async function ensureDefaultPlans(db: Db = prisma) {
  const defaults = [
    { code: "trial", name: "Trial", maxUsers: 5, maxActiveJobs: 50, maxSites: 3 },
    { code: "starter", name: "Starter", maxUsers: 10, maxActiveJobs: 300, maxSites: 5 },
    { code: "professional", name: "Professional", maxUsers: 50, maxActiveJobs: null, maxSites: null },
  ];
  for (const p of defaults) await db.plan.upsert({ where: { code: p.code }, update: {}, create: p });
}

export type Metered = "users" | "activeJobs" | "sites";

export async function usage(db: Db, orgId: string): Promise<Record<Metered, number>> {
  const [users, activeJobs, sites] = await Promise.all([
    // Requesters (people who only report faults) are free: only maintenance staff and approvers are metered.
    db.membership.count({ where: { orgId, active: true, roles: { hasSome: ["OWNER", "MANAGER", "APPROVER", "TECHNICIAN"] } } }),
    db.job.count({ where: { orgId, status: { in: OPEN_STATUSES } } }),
    db.site.count({ where: { orgId, archived: false } }),
  ]);
  return { users, activeJobs, sites };
}

/** Throws if creating one more of `what` would exceed the plan. Demo workspaces are unmetered. */
export async function assertWithinPlan(db: Db, orgId: string, what: Metered): Promise<void> {
  const org = await db.organisation.findUniqueOrThrow({
    where: { id: orgId },
    include: { subscription: { include: { plan: true } } },
  });
  if (org.isDemo || !org.subscription) return;
  const plan = org.subscription.plan;
  const limit = { users: plan.maxUsers, activeJobs: plan.maxActiveJobs, sites: plan.maxSites }[what];
  if (limit == null) return;
  const used = (await usage(db, orgId))[what];
  if (used >= limit) {
    const label = { users: "team members", activeJobs: "open jobs", sites: "sites" }[what];
    throw new AppError("SUBSCRIPTION", `Your ${plan.name} plan allows ${limit} ${label}. Upgrade your plan to add more.`);
  }
}

/** Contract a future payment-provider adapter implements; webhooks translate into setSubscription(). */
export interface BillingProvider {
  createCheckout(orgId: string, planCode: string): Promise<{ url: string }>;
}

export interface SubscriptionChange {
  planCode?: string;
  status?: SubscriptionStatus;
  trialEndsAt?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  graceEndsAt?: Date | null;
  providerRef?: string | null;
}

/** Platform operator (or a provider webhook acting as one) changes a tenant's subscription. Audited. */
export async function setSubscription(actor: { id: string; isPlatformAdmin: boolean }, orgId: string, c: SubscriptionChange) {
  if (!actor.isPlatformAdmin) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const { planCode, ...rest } = c;
    const plan = planCode ? await tx.plan.findUniqueOrThrow({ where: { code: planCode } }) : null;
    const sub = await tx.subscription.update({
      where: { orgId },
      data: { ...rest, ...(plan ? { planId: plan.id } : {}) },
    });
    await tx.activityEvent.create({
      data: {
        orgId, type: "subscription.changed", actorUserId: actor.id, actorLabel: "Platform operator",
        summary: `Subscription set to ${sub.status}${plan ? ` on ${plan.name}` : ""}`,
        data: JSON.parse(JSON.stringify(c)),
      },
    });
    return sub;
  });
}
