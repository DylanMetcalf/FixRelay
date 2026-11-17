/**
 * Data export (POPIA access requests and "your data is yours").
 * - Company export (owner): every business record of the tenant, as JSON. Works even when the subscription is
 *   locked. Never includes password hashes, token hashes, sessions or other companies' data.
 * - Customer export (manager): everything held about one client organisation and its people, to answer a
 *   data-subject access request.
 * File contents are not embedded (they can be large); each file is listed with its authorised download path.
 * Every export is written to the audit trail.
 */
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { can, type Ctx } from "../permissions";
import { forbidden } from "@/lib/errors";
import { actorOf, logEvent } from "./activity";

const userFields = { id: true, name: true, email: true, createdAt: true } as const;
const file = (a: { id: string; kind: string; filename: string; mimeType: string; sizeBytes: number; createdAt: Date; jobId: string | null }) =>
  ({ ...a, download: `/api/files/${a.id}` });

export async function exportCompany(ctx: Ctx) {
  if (!can(ctx, "org.manage") && !(ctx.roles.includes("OWNER") && ctx.locked)) throw forbidden();
  const where = { orgId: ctx.orgId };
  const [org, members, clients, sites, locations, assets, jobs, assessments, quotes, updates, completions, decisions, attachments, events] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { subscription: { include: { plan: true } }, priorities: true } }),
    prisma.membership.findMany({ where, include: { user: { select: userFields } } }),
    prisma.client.findMany({ where }), prisma.site.findMany({ where }), prisma.location.findMany({ where }), prisma.asset.findMany({ where }),
    prisma.job.findMany({ where, include: { technicians: true } }), prisma.assessment.findMany({ where }),
    prisma.quote.findMany({ where, include: { lines: true } }), prisma.workUpdate.findMany({ where }), prisma.completion.findMany({ where }),
    prisma.decision.findMany({ where }), prisma.attachment.findMany({ where, select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, jobId: true } }),
    prisma.activityEvent.findMany({ where, orderBy: { createdAt: "asc" } }),
  ]);
  await prisma.$transaction((tx) => logEvent(tx, actorOf(ctx), null, "data.exported", "Full company data export downloaded"));
  return {
    format: "fixrelay-export/1", exportedAt: new Date().toISOString(), exportedBy: ctx.userEmail,
    organisation: org, members, clients, sites, locations, assets, jobs, assessments, quotes, workUpdates: updates,
    completions, decisions, files: attachments.map(file), auditTrail: events,
  };
}

export async function exportClient(ctx: Ctx, clientId: string) {
  if (!can(ctx, "clients.manage") && !can(ctx, "reports.view")) throw forbidden();
  const client = await prisma.client.findFirst({ where: { id: clientId, orgId: ctx.orgId }, include: { sites: { include: { locations: true, assets: true } } } });
  if (!client) throw notFound("Customer not found.");
  const where = { orgId: ctx.orgId, clientId };
  const jobs = await prisma.job.findMany({ where, include: { assessments: true, quotes: { include: { lines: true, decision: true } }, completions: { include: { decision: true } }, updates: true } });
  const jobIds = jobs.map((j) => j.id);
  const [portalUsers, attachments, events, links] = await Promise.all([
    prisma.membership.findMany({ where: { orgId: ctx.orgId, clientId }, include: { user: { select: userFields } } }),
    prisma.attachment.findMany({ where: { orgId: ctx.orgId, jobId: { in: jobIds } }, select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, jobId: true } }),
    prisma.activityEvent.findMany({ where: { orgId: ctx.orgId, jobId: { in: jobIds } }, orderBy: { createdAt: "asc" } }),
    prisma.approvalLink.findMany({ where: { orgId: ctx.orgId, OR: [{ quote: { jobId: { in: jobIds } } }, { completion: { jobId: { in: jobIds } } }] },
      select: { id: true, purpose: true, recipientName: true, recipientEmail: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } }),
  ]);
  await prisma.$transaction((tx) => logEvent(tx, actorOf(ctx), null, "data.exported", `Data export for customer "${client.name}" downloaded`));
  return { format: "fixrelay-customer-export/1", exportedAt: new Date().toISOString(), exportedBy: ctx.userEmail, customer: client, portalUsers, jobs, reviewLinksSent: links, files: attachments.map(file), auditTrail: events };
}
