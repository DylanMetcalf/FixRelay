/**
 * The Resultra platform owner's tools. The platform owner sees ACCOUNT METADATA ONLY: companies, sites, contacts,
 * users and their roles, departments, onboarding progress, subscription, email delivery and platform errors.
 * Jobs, quotes, photos, reports and other business data stay private; opening a company needs a time-limited,
 * audited grant from that company (see SupportAccessGrant).
 */
import { z } from "zod";
import { appUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { conflict, forbidden, invalid } from "@/lib/errors";
import { hashToken, newToken } from "@/lib/tokens";
import { emailSchema } from "../auth";
import { logEvent } from "./activity";
import { queueEmail } from "./notifications";
import { createOrganisation, INVITE_DAYS } from "./orgs";
import { newPublicCode, newSiteToken } from "./sites";

type Admin = { id: string; name: string; isPlatformAdmin: boolean };
const requireAdmin = (u: Admin) => { if (!u.isPlatformAdmin) throw forbidden(); };

const customerSchema = z.object({
  companyName: z.string().trim().min(2, "Enter the company name.").max(120),
  siteName: z.string().trim().min(2, "Enter the first site's name.").max(120),
  siteAddress: z.string().trim().max(300).default(""),
  contactName: z.string().trim().min(2, "Enter the main contact's name.").max(120),
  contactEmail: emailSchema,
  phone: z.string().trim().max(40).default(""),
  departments: z.array(z.string().trim().min(2).max(60)).max(12).default(["Maintenance", "Operations", "Management", "Finance"]),
  publicReporting: z.boolean().default(true),
});

/**
 * Create a customer: company (trial), first site with QR codes, starting departments, and a secure invitation that
 * makes the main contact the site administrator (OWNER) when accepted.
 */
export async function createCustomer(admin: Admin, input: z.input<typeof customerSchema>) {
  requireAdmin(admin);
  const p = customerSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  if (await prisma.user.findFirst({ where: { email: d.contactEmail, memberships: { some: { org: { name: d.companyName, archivedAt: null } } } } }))
    throw conflict("This contact already belongs to a company with that name.");
  const token = newToken();
  const result = await prisma.$transaction(async (tx) => {
    const org = await createOrganisation(tx, null, d.companyName);
    await tx.organisation.update({ where: { id: org.id }, data: { contactEmail: d.contactEmail, phone: d.phone, publicReportingEnabled: d.publicReporting } });
    const site = await tx.site.create({ data: { orgId: org.id, name: d.siteName, address: d.siteAddress, publicToken: newSiteToken(), publicCode: newPublicCode() } });
    for (const name of [...new Set(d.departments)]) await tx.department.create({ data: { orgId: org.id, name } });
    const inv = await tx.invitation.create({ data: {
      orgId: org.id, email: d.contactEmail, name: d.contactName, roles: ["OWNER", "MANAGER"], siteIds: [],
      tokenHash: hashToken(token), invitedBy: admin.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    } });
    await queueEmail(tx, {
      orgId: org.id, to: d.contactEmail, subject: `Your Resultra account for ${d.companyName} is ready`, dedupeKey: `customer-invite:${inv.id}`,
      body: `Hi ${d.contactName},\n\nResultra is set up for ${d.companyName} (site: ${d.siteName}). Accept this invitation to become the site administrator, add your team and print your QR codes:\n${appUrl()}/invite/${token}\n\nThe link expires in ${INVITE_DAYS} days.`,
    });
    await logEvent(tx, { orgId: org.id, userId: admin.id, label: `${admin.name} (Resultra platform)` }, null, "org.created_by_platform",
      `Company created by the Resultra platform owner; ${d.contactEmail} invited as site administrator`);
    return { orgId: org.id, siteId: site.id };
  });
  return { ...result, inviteLink: `${appUrl()}/invite/${token}` };
}

/** Re-send (replace) the main contact's invitation. */
export async function resendCustomerInvite(admin: Admin, orgId: string) {
  requireAdmin(admin);
  const old = await prisma.invitation.findFirst({ where: { orgId, roles: { has: "OWNER" }, acceptedAt: null }, orderBy: { createdAt: "desc" } });
  if (!old) throw conflict("There is no open administrator invitation for this company.");
  const token = newToken();
  await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { orgId, email: old.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await tx.invitation.create({ data: { orgId, email: old.email, name: old.name, roles: old.roles, siteIds: [], tokenHash: hashToken(token), invitedBy: admin.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
    await queueEmail(tx, { orgId, to: old.email, subject: `Your Resultra account for ${org.name} is ready`, dedupeKey: `customer-invite:${inv.id}`,
      body: `Hi ${old.name},\n\nAccept this invitation to become the site administrator for ${org.name}:\n${appUrl()}/invite/${token}\n\nThe link expires in ${INVITE_DAYS} days.` });
  });
  return `${appUrl()}/invite/${token}`;
}

/** Every customer company with the account facts the platform owner needs. */
export async function platformOverview(admin: Admin, opts: { q?: string; take?: number } = {}) {
  requireAdmin(admin);
  const q = opts.q?.trim().slice(0, 80);
  const orgs = await prisma.organisation.findMany({
    where: { isDemo: false, archivedAt: null, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
    orderBy: { createdAt: "desc" }, take: opts.take ?? 50,
    select: { id: true, name: true, createdAt: true, contactEmail: true, phone: true, publicReportingEnabled: true, subscription: { include: { plan: true } } },
  });
  const ids = orgs.map((o) => o.id);
  const [members, sites, depts, jobs, invites, outbox, grants] = await Promise.all([
    prisma.membership.findMany({ where: { orgId: { in: ids } }, select: { orgId: true, roles: true, active: true, status: true, user: { select: { name: true, email: true } } } }),
    prisma.site.groupBy({ by: ["orgId"], where: { orgId: { in: ids }, archived: false }, _count: true }),
    prisma.department.groupBy({ by: ["orgId"], where: { orgId: { in: ids }, archived: false }, _count: true }),
    prisma.job.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: true }),
    prisma.invitation.findMany({ where: { orgId: { in: ids }, roles: { has: "OWNER" }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { orgId: true, email: true, name: true } }),
    prisma.outboxEmail.groupBy({ by: ["orgId", "status"], where: { orgId: { in: ids } }, _count: true }),
    prisma.supportAccessGrant.findMany({ where: { orgId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() } }, select: { orgId: true, expiresAt: true } }),
  ]);
  const n = (rows: { orgId: string; _count: number }[], id: string) => rows.find((r) => r.orgId === id)?._count ?? 0;
  return orgs.map((o) => {
    const m = members.filter((x) => x.orgId === o.id);
    const active = m.filter((x) => x.active);
    const owner = active.find((x) => x.roles.includes("OWNER"));
    const invite = invites.find((i) => i.orgId === o.id);
    const counts = { sites: n(sites, o.id), departments: n(depts, o.id), jobs: n(jobs, o.id), users: active.length, pending: m.filter((x) => x.status === "PENDING").length };
    const steps = [
      { label: "Administrator joined", done: !!owner },
      { label: "Site added", done: counts.sites > 0 },
      { label: "Departments set up", done: counts.departments > 0 },
      { label: "Team added (2+ people)", done: counts.users >= 2 },
      { label: "First job reported", done: counts.jobs > 0 },
    ];
    const mail = (st: string) => outbox.find((x) => x.orgId === o.id && x.status === st)?._count ?? 0;
    return {
      ...o, counts, steps, onboarded: steps.filter((x) => x.done).length,
      contact: owner ? { name: owner.user.name, email: owner.user.email, joined: true } : invite ? { name: invite.name, email: invite.email, joined: false } : null,
      email: { sent: mail("SENT"), pending: mail("PENDING"), failed: mail("FAILED") },
      supportUntil: grants.find((g) => g.orgId === o.id)?.expiresAt ?? null,
    };
  });
}

/** One company's account details: sites, users (roles, status, departments) and departments. No business data. */
export async function customerDetail(admin: Admin, orgId: string) {
  requireAdmin(admin);
  const org = await prisma.organisation.findFirst({ where: { id: orgId, isDemo: false }, select: { id: true, name: true, contactEmail: true, phone: true, address: true, createdAt: true, publicReportingEnabled: true, subscription: { include: { plan: true } } } });
  if (!org) return null;
  const [sites, members, departments, failures] = await Promise.all([
    prisma.site.findMany({ where: { orgId }, select: { id: true, name: true, address: true, archived: true, _count: { select: { locations: true } } }, orderBy: { name: "asc" } }),
    prisma.membership.findMany({ where: { orgId }, select: { userId: true, roles: true, active: true, status: true, createdAt: true, user: { select: { name: true, email: true, emailVerifiedAt: true, jobTitle: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.department.findMany({ where: { orgId, archived: false }, include: { members: true }, orderBy: { name: "asc" } }),
    prisma.outboxEmail.findMany({ where: { orgId, status: "FAILED" }, select: { id: true, toEmail: true, lastError: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 }), // no subjects: they can name jobs
  ]);
  const deptsOf = (userId: string) => departments.filter((d) => d.members.some((x) => x.userId === userId)).map((d) => d.name);
  return { org, sites, members: members.map((m) => ({ ...m, departments: deptsOf(m.userId) })), departments: departments.map((d) => ({ id: d.id, name: d.name, members: d.members.length })), failures };
}

/** Platform health: unexpected errors and email delivery across all companies. */
export async function platformHealth(admin: Admin) {
  requireAdmin(admin);
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [errors, byStatus, failed] = await Promise.all([
    prisma.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.outboxEmail.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.outboxEmail.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, orgId: true, toEmail: true, lastError: true, createdAt: true } }),
  ]);
  return { errors, email: Object.fromEntries(byStatus.map((x) => [x.status, x._count])) as Record<string, number>, failed };
}
