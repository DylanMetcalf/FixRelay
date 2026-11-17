/**
 * Permission model. Every service function starts with `requirePerm(ctx, ...)` and every job
 * query is filtered through `jobScope(ctx)`. The UI may hide buttons, but this is the enforcement
 * point. The matrix is documented in SECURITY.md.
 */
import type { Prisma, Role } from "@prisma/client";
import { AppError, forbidden } from "@/lib/errors";

export interface Ctx {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  roles: Role[];
  /** Set when the member belongs to a client organisation: hard-limits everything to that client. */
  clientId: string | null;
  /** Platform operator viewing under an explicit SupportAccessGrant: read-only. */
  support: boolean;
  /** Subscription suspended / expired past grace: tenant is read-only (data stays retrievable). */
  locked: boolean;
  /** The user's email address has been confirmed (required before emailing other people). */
  emailVerified: boolean;
}

const STAFF: Role[] = ["OWNER", "MANAGER", "TECHNICIAN"];
const MANAGERS: Role[] = ["OWNER", "MANAGER"];

/** permission -> roles that hold it. `write: false` permissions stay available when read-only. */
export const PERMISSIONS = {
  "org.manage": { roles: ["OWNER"], write: true },
  "team.manage": { roles: ["OWNER"], write: true },
  "team.view": { roles: MANAGERS, write: false },
  "clients.manage": { roles: MANAGERS, write: true },
  "clients.view": { roles: STAFF, write: false },
  "job.create": { roles: ["OWNER", "MANAGER", "TECHNICIAN", "CLIENT", "REQUESTER"], write: true },
  "job.viewAll": { roles: MANAGERS, write: false },
  "job.manage": { roles: MANAGERS, write: true }, // triage, authorise, assign, hold, cancel, close, reopen
  "job.assess": { roles: STAFF, write: true }, // technicians: only on jobs in their scope
  "job.work": { roles: STAFF, write: true }, // start, update, hold, submit completion
  "quote.manage": { roles: MANAGERS, write: true },
  "quote.view": { roles: ["OWNER", "MANAGER", "CLIENT"], write: false },
  "customer.decide": { roles: ["CLIENT"], write: true }, // approve/reject quotes and completed work
  "signoff.capture": { roles: STAFF, write: true }, // capture the customer's in-person sign-off
  "reports.view": { roles: MANAGERS, write: false },
} as const satisfies Record<string, { roles: readonly Role[]; write: boolean }>;

export type Permission = keyof typeof PERMISSIONS;

const SUPPORT_PERMS: Permission[] = ["job.viewAll", "clients.view", "quote.view", "reports.view", "team.view"];

export function can(ctx: Ctx, perm: Permission): boolean {
  const def = PERMISSIONS[perm];
  if (ctx.support) return SUPPORT_PERMS.includes(perm);
  if (def.write && ctx.locked) return false;
  return (def.roles as readonly Role[]).some((r) => ctx.roles.includes(r));
}

export function requirePerm(ctx: Ctx, perm: Permission): void {
  if (can(ctx, perm)) return;
  if (PERMISSIONS[perm].write && ctx.locked && !ctx.support)
    throw new AppError(
      "SUBSCRIPTION",
      "This account is read-only because the subscription is not active. Your records remain available to view and export.",
    );
  throw forbidden();
}

export const isManager = (ctx: Ctx) => can(ctx, "job.viewAll");
export const isStaff = (ctx: Ctx) => ctx.support || ctx.roles.some((r) => STAFF.includes(r));

/**
 * Row-level visibility for jobs. ALWAYS spread into job queries.
 * - Owners/managers (and audited support): every job in the tenant.
 * - Technicians: jobs they lead, are added to, or reported.
 * - Client representatives: jobs of their own client organisation only.
 * - Requesters: jobs they reported.
 * A member tied to a client organisation never sees another client's jobs, whatever their roles.
 */
export function jobScope(ctx: Ctx): Prisma.JobWhereInput {
  const base: Prisma.JobWhereInput = { orgId: ctx.orgId };
  if (ctx.clientId) base.clientId = ctx.clientId;
  if (can(ctx, "job.viewAll") && !ctx.clientId) return base;
  const or: Prisma.JobWhereInput[] = [{ requesterId: ctx.userId }];
  if (ctx.roles.includes("TECHNICIAN") && !ctx.clientId)
    or.push({ leadTechnicianId: ctx.userId }, { technicians: { some: { userId: ctx.userId } } });
  if (ctx.roles.includes("CLIENT") && ctx.clientId) or.push({ clientId: ctx.clientId });
  return { ...base, OR: or };
}
