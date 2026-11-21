/**
 * Notifications = in-app rows + a transactional email outbox.
 * - `notify` runs inside the business transaction, so a notification exists iff the change committed.
 * - `dedupeKey` (unique) makes repeats idempotent: the same event never notifies the same person twice.
 * - `processOutbox` is run by the worker (src/worker.ts). Rows are claimed with FOR UPDATE SKIP LOCKED,
 *   so several workers can run safely. Failures retry with exponential backoff, then become FAILED.
 */
import { prisma, type Tx } from "@/lib/db";
import { consoleTransport, type EmailTransport, renderEmailHtml } from "../email";

export { consoleTransport, type EmailTransport };
import type { Ctx } from "../permissions";
import { OPEN_STATUSES } from "../workflow";

export const MAX_ATTEMPTS = 5;

/** example.com/.net/.org, *.example, *.invalid, *.test, *.localhost – reserved, never deliverable. */
export const isReservedAddress = (to: string) => /@((.+\.)?example\.(com|net|org)|.+\.(example|invalid|test|localhost))$/i.test(to.trim());

export interface NotifyInput {
  orgId: string;
  userIds: (string | null | undefined)[];
  jobId?: string | null;
  type: string;
  title: string;
  body?: string;
  /** Stable identifier of the triggering event, e.g. `quote-submitted:<quoteId>`. */
  eventKey: string;
  exceptUserId?: string | null;
}

export async function notify(tx: Tx, n: NotifyInput): Promise<void> {
  const ids = [...new Set(n.userIds.filter((x): x is string => !!x && x !== n.exceptUserId))];
  if (ids.length === 0) return;
  const users = await tx.user.findMany({
    where: { id: { in: ids }, memberships: { some: { orgId: n.orgId, active: true } } },
    select: { id: true, email: true },
  });
  await tx.notification.createMany({
    data: users.map((u) => ({
      orgId: n.orgId, userId: u.id, jobId: n.jobId ?? null, type: n.type, title: n.title,
      body: n.body ?? "", dedupeKey: `${n.eventKey}:${u.id}`,
    })),
    skipDuplicates: true,
  });
  await tx.outboxEmail.createMany({
    data: users.map((u) => ({
      orgId: n.orgId, toEmail: u.email, subject: n.title,
      body: `${n.body ?? n.title}\n\nOpen Resultra to view the details.`, dedupeKey: `${n.eventKey}:${u.id}`,
    })),
    skipDuplicates: true,
  });
}

export async function queueEmail(tx: Tx, e: { orgId: string | null; to: string; subject: string; body: string; dedupeKey: string }) {
  await tx.outboxEmail.createMany({
    data: [{ orgId: e.orgId, toEmail: e.to, subject: e.subject, body: e.body, dedupeKey: e.dedupeKey }],
    skipDuplicates: true,
  });
}

/** Stores / procurement people who cover a site (empty site list = all sites). */
export async function storesIds(tx: Tx, orgId: string, siteId: string): Promise<string[]> {
  const ms = await tx.membership.findMany({ where: { orgId, active: true, roles: { has: "STORES" } }, select: { userId: true, siteIds: true } });
  return ms.filter((m) => !m.siteIds.length || m.siteIds.includes(siteId)).map((m) => m.userId);
}

export async function managerIds(tx: Tx, orgId: string): Promise<string[]> {
  const ms = await tx.membership.findMany({
    where: { orgId, active: true, roles: { hasSome: ["OWNER", "MANAGER"] } },
    select: { userId: true },
  });
  return ms.map((m) => m.userId);
}

/** Send due emails. Returns counts. Safe to run concurrently. */
export async function processOutbox(transport: EmailTransport = consoleTransport, limit = 20, now = new Date()) {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const done = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "OutboxEmail" WHERE status = 'PENDING' AND "nextAttemptAt" <= ${now}
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const row = rows[0];
      if (!row) return false;
      const email = await tx.outboxEmail.findUniqueOrThrow({ where: { id: row.id } });
      if (isReservedAddress(email.toEmail)) {
        // Demo and test data use reserved domains (RFC 2606/6761). Never send to them: they bounce and hurt the sender's reputation.
        await tx.outboxEmail.update({ where: { id: email.id }, data: { status: "SENT", sentAt: now, body: "[not sent: reserved domain]", attempts: { increment: 1 } } });
        return true;
      }
      const org = email.orgId ? await tx.organisation.findUnique({ where: { id: email.orgId }, select: { name: true, brandColour: true, contactEmail: true } }) : null;
      try {
        await transport.send({
          to: email.toEmail, subject: email.subject, text: email.body, replyTo: org?.contactEmail || undefined,
          html: renderEmailHtml({ subject: email.subject, text: email.body, brandName: org?.name ?? "Resultra", brandColour: org?.brandColour ?? "#1E5AA8" }),
        });
        // The body can contain a one-time approval link: do not keep it once delivered.
        await tx.outboxEmail.update({
          where: { id: email.id },
          data: { status: "SENT", sentAt: now, attempts: { increment: 1 }, body: "[sent]", lastError: null },
        });
        sent++;
      } catch (e) {
        const attempts = email.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await tx.outboxEmail.update({
          where: { id: email.id },
          data: {
            attempts, status: giveUp ? "FAILED" : "PENDING",
            lastError: String(e instanceof Error ? e.message : e).slice(0, 500),
            nextAttemptAt: new Date(now.getTime() + 60_000 * 2 ** attempts), // 2, 4, 8, 16 minutes
          },
        });
        failed++;
      }
      return true;
    });
    if (!done) break;
  }
  return { sent, failed };
}

/** Notify once per job when it passes its due date. Run periodically by the worker. */
export async function scanOverdue(now = new Date()): Promise<number> {
  const jobs = await prisma.job.findMany({
    where: { status: { in: OPEN_STATUSES }, dueAt: { lt: now }, overdueNotifiedAt: null },
    select: { id: true, orgId: true, reference: true, title: true, ownerId: true, leadTechnicianId: true },
    take: 200,
  });
  let n = 0;
  for (const j of jobs) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.job.updateMany({ where: { id: j.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
      if (claimed.count !== 1) return;
      await notify(tx, {
        orgId: j.orgId, jobId: j.id, type: "job.overdue", title: `${j.reference} is overdue`, body: j.title,
        userIds: [...(await managerIds(tx, j.orgId)), j.leadTechnicianId], eventKey: `overdue:${j.id}:${now.toISOString().slice(0, 10)}`,
      });
      n++;
    });
  }
  return n;
}

export function listNotifications(ctx: Ctx, take = 50) {
  return prisma.notification.findMany({
    where: { orgId: ctx.orgId, userId: ctx.userId }, orderBy: { createdAt: "desc" }, take,
  });
}
export const unreadCount = (ctx: Ctx) =>
  prisma.notification.count({ where: { orgId: ctx.orgId, userId: ctx.userId, readAt: null } });
export const markAllRead = (ctx: Ctx) =>
  prisma.notification.updateMany({ where: { orgId: ctx.orgId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });

/**
 * Retention (POPIA minimality). Run daily by the worker:
 *  - delivered/failed emails older than 90 days, read notifications older than 180 days, unread older than 365 days;
 *  - used or expired account tokens; expired sessions; expired rate-limit windows.
 * Business records (jobs, quotes, decisions, audit trail) are kept: they are the company's lawful records.
 */
export async function purgeRetention(now = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const [emails, readN, oldN, tokens, sessions, limits] = await prisma.$transaction([
    prisma.outboxEmail.deleteMany({ where: { status: { in: ["SENT", "FAILED"] }, createdAt: { lt: days(90) } } }),
    prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: days(180) } } }),
    prisma.notification.deleteMany({ where: { createdAt: { lt: days(365) } } }),
    prisma.authToken.deleteMany({ where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } }),
  ]);
  return { emails: emails.count, notifications: readN.count + oldN.count, tokens: tokens.count, sessions: sessions.count, rateLimits: limits.count };
}

/** Opening a job clears its alerts for that person. */
export const markJobRead = (ctx: Ctx, jobId: string) =>
  prisma.notification.updateMany({ where: { orgId: ctx.orgId, userId: ctx.userId, jobId, readAt: null }, data: { readAt: new Date() } });
