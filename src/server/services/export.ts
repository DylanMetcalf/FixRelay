/**
 * Company data export (owner): every business record of the organisation as JSON — "your data is yours", and the
 * basis for answering POPIA access requests. Works even when the subscription is locked. Never includes password
 * hashes, token hashes, sessions or other organisations' data. File contents are listed with their authorised
 * download path, not embedded. Every export is written to the audit trail.
 */
import { prisma } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { can, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";

const userFields = { id: true, name: true, email: true, createdAt: true } as const;

export async function exportCompany(ctx: Ctx) {
  if (!can(ctx, "org.manage") && !(ctx.roles.includes("OWNER") && ctx.locked)) throw forbidden();
  const where = { orgId: ctx.orgId };
  const [org, members, sites, locations, assets, contractors, jobs, assessments, quotes, updates, completions, decisions, links, attachments, events] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { subscription: { include: { plan: true } }, priorities: true } }),
    prisma.membership.findMany({ where, include: { user: { select: userFields } } }),
    prisma.site.findMany({ where, omit: { publicToken: true } }), prisma.location.findMany({ where }), prisma.asset.findMany({ where }),
    prisma.contractor.findMany({ where }),
    prisma.job.findMany({ where, include: { technicians: true } }), prisma.assessment.findMany({ where }),
    prisma.quote.findMany({ where, include: { lines: true } }), prisma.workUpdate.findMany({ where }), prisma.completion.findMany({ where }),
    prisma.decision.findMany({ where }),
    prisma.contractorLink.findMany({ where, omit: { tokenHash: true } }),
    prisma.attachment.findMany({ where, select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, jobId: true, quoteId: true, completionId: true } }),
    prisma.activityEvent.findMany({ where, orderBy: { createdAt: "asc" } }),
  ]);
  await prisma.$transaction((tx) => logEvent(tx, actorOf(ctx), null, "data.exported", "Full company data export downloaded"));
  return {
    format: "fixrelay-export/2", exportedAt: new Date().toISOString(), exportedBy: ctx.userEmail,
    organisation: org, members, sites, locations, assets, contractors, jobs, assessments, quotes, workUpdates: updates,
    completions, decisions, contractorLinks: links, files: attachments.map((a) => ({ ...a, download: `/api/files/${a.id}` })), auditTrail: events,
  };
}
