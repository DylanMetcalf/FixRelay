/**
 * Permission model for an internal site maintenance system. Every service function starts with
 * `requirePerm(ctx, ...)` and every job query is filtered through `jobScope(ctx)`. The UI may hide buttons,
 * but this is the enforcement point. Matrix documented in SECURITY.md.
 *
 * Roles: OWNER (account admin) · MANAGER (maintenance manager) · APPROVER (site/finance manager who approves
 * spend) · TECHNICIAN (in-house) · REQUESTER (anyone on site who reports faults).
 * Spending authority by amount: see `approvalLimit`.
 */
import type { Prisma, Role } from "@prisma/client";
import { AppError, forbidden } from "@/lib/errors";

export interface Ctx {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  roles: Role[];
  /** Sites this member is limited to. Empty = every site of the organisation. */
  siteIds: string[];
  /** Platform operator viewing under an explicit SupportAccessGrant: read-only. */
  support: boolean;
  /** Subscription suspended / expired past grace: tenant is read-only (data stays retrievable). */
  locked: boolean;
  /** The user's email address has been confirmed (required before emailing other people). */
  emailVerified: boolean;
}

const MANAGERS: Role[] = ["OWNER", "MANAGER"];
const STAFF: Role[] = ["OWNER", "MANAGER", "TECHNICIAN"];
const OVERSIGHT: Role[] = ["OWNER", "MANAGER", "APPROVER"];

/** permission -> roles that hold it. `write: false` permissions stay available when read-only. */
export const PERMISSIONS = {
  "org.manage": { roles: ["OWNER"], write: true },
  "team.manage": { roles: ["OWNER"], write: true },
  "team.view": { roles: MANAGERS, write: false },
  "sites.manage": { roles: MANAGERS, write: true }, // sites, locations, assets, QR codes
  "sites.view": { roles: ["OWNER", "MANAGER", "APPROVER", "TECHNICIAN"], write: false },
  "contractors.manage": { roles: MANAGERS, write: true },
  "contractors.view": { roles: OVERSIGHT, write: false },
  "job.create": { roles: ["OWNER", "MANAGER", "APPROVER", "TECHNICIAN", "REQUESTER"], write: true },
  "job.viewAll": { roles: OVERSIGHT, write: false }, // within the member's sites
  "job.manage": { roles: MANAGERS, write: true }, // triage, route, quotes, assign, hold, cancel, close, reopen
  "job.assess": { roles: STAFF, write: true }, // technicians: only jobs they are assigned to
  "job.work": { roles: STAFF, write: true },
  "quote.manage": { roles: MANAGERS, write: true },
  "quote.view": { roles: OVERSIGHT, write: false },
  "spend.approve": { roles: OVERSIGHT, write: true }, // limited by amount (approvalLimit)
  "reports.view": { roles: OVERSIGHT, write: false },
} as const satisfies Record<string, { roles: readonly Role[]; write: boolean }>;

export type Permission = keyof typeof PERMISSIONS;

const SUPPORT_PERMS: Permission[] = ["job.viewAll", "sites.view", "contractors.view", "quote.view", "reports.view", "team.view"];

export function can(ctx: Ctx, perm: Permission): boolean {
  const def = PERMISSIONS[perm];
  if (ctx.support) return SUPPORT_PERMS.includes(perm);
  if (def.write && ctx.locked) return false;
  return (def.roles as readonly Role[]).some((r) => ctx.roles.includes(r));
}

export function requirePerm(ctx: Ctx, perm: Permission): void {
  if (can(ctx, perm)) return;
  if (PERMISSIONS[perm].write && ctx.locked && !ctx.support)
    throw new AppError("SUBSCRIPTION", "This account is read-only because the subscription is not active. Your records remain available to view and export.");
  throw forbidden();
}

export const isManager = (ctx: Ctx) => can(ctx, "job.manage");
export const isStaff = (ctx: Ctx) => ctx.support || ctx.roles.some((r) => STAFF.includes(r) || r === "APPROVER");

export interface ApprovalRules { managerApprovalLimitCents: number; approverApprovalLimitCents: number | null }

/**
 * The highest amount (cents incl. VAT) this member may approve: Owner unlimited; Approver up to the approver
 * limit (unlimited if not set); Maintenance manager up to the manager limit; others 0.
 */
export function approvalLimit(ctx: Ctx, rules: ApprovalRules): number {
  if (ctx.support || ctx.locked) return 0;
  if (ctx.roles.includes("OWNER")) return Number.POSITIVE_INFINITY;
  let limit = 0;
  if (ctx.roles.includes("APPROVER")) limit = Math.max(limit, rules.approverApprovalLimitCents ?? Number.POSITIVE_INFINITY);
  if (ctx.roles.includes("MANAGER")) limit = Math.max(limit, rules.managerApprovalLimitCents);
  return limit;
}

/** Site restriction for any site-owned query. */
export const siteFilter = (ctx: Ctx): { siteId?: { in: string[] } } => (ctx.siteIds.length ? { siteId: { in: ctx.siteIds } } : {});

/**
 * Row-level visibility for jobs. ALWAYS spread into job queries.
 * - Owner / Manager / Approver (and audited support): every job at their sites.
 * - Technicians: jobs they lead, are added to, or reported.
 * - Requesters: jobs they reported.
 */
export function jobScope(ctx: Ctx): Prisma.JobWhereInput {
  const base: Prisma.JobWhereInput = { orgId: ctx.orgId, ...siteFilter(ctx) };
  if (can(ctx, "job.viewAll")) return base;
  const or: Prisma.JobWhereInput[] = [{ requesterId: ctx.userId }];
  if (ctx.roles.includes("TECHNICIAN")) or.push({ leadTechnicianId: ctx.userId }, { technicians: { some: { userId: ctx.userId } } });
  return { ...base, OR: or };
}
