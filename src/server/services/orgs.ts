/** Tenant (subscribing company) lifecycle: registration, settings, team, invitations, support access. */
import type { Priority, Role } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { hashToken, newToken } from "@/lib/tokens";
import { createSession, emailSchema, hashPassword, passwordSchema } from "../auth";
import { requirePerm, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";
import { assertWithinPlan, ensureDefaultPlans, TRIAL_DAYS } from "./billing";
import { sendVerificationEmail, requireVerifiedEmail } from "./account";
import { queueEmail } from "./notifications";

const name = z.string().trim().min(2, "Too short.").max(120);
const text = (max: number) => z.string().trim().max(max).default("");

export const DEFAULT_PRIORITIES: { priority: Priority; responseHours: number; completionHours: number }[] = [
  { priority: "LOW", responseHours: 72, completionHours: 336 },
  { priority: "NORMAL", responseHours: 24, completionHours: 120 },
  { priority: "HIGH", responseHours: 8, completionHours: 48 },
  { priority: "CRITICAL", responseHours: 2, completionHours: 24 },
];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";

export async function createOrganisation(tx: Tx, ownerId: string, companyName: string, isDemo = false) {
  const base = slugify(companyName);
  let slug = base;
  for (let i = 0; await tx.organisation.findUnique({ where: { slug } }); i++) slug = `${base}-${newToken().slice(0, 5).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  const org = await tx.organisation.create({ data: { name: companyName, slug, isDemo } });
  await tx.membership.create({ data: { orgId: org.id, userId: ownerId, roles: ["OWNER"] } });
  await tx.priorityRule.createMany({ data: DEFAULT_PRIORITIES.map((p) => ({ ...p, orgId: org.id })) });
  if (!isDemo) {
    await ensureDefaultPlans(tx);
    const plan = await tx.plan.findUniqueOrThrow({ where: { code: "trial" } });
    await tx.subscription.create({
      data: { orgId: org.id, planId: plan.id, status: "TRIALING", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) },
    });
  }
  return org;
}

const registerSchema = z.object({ name, companyName: name, email: emailSchema, password: passwordSchema });

/** Self-service sign-up: creates the user, the company, an OWNER membership and a trial subscription. */
export async function registerCompany(input: z.input<typeof registerSchema>) {
  const p = registerSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const passwordHash = await hashPassword(p.data.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: p.data.email, name: p.data.name, passwordHash } });
      const org = await createOrganisation(tx, user.id, p.data.companyName);
      await sendVerificationEmail(tx, user);
      const token = await createSession(tx, user.id, org.id);
      return { userId: user.id, orgId: org.id, token };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An account with this email already exists. Sign in instead.");
    throw e;
  }
}

const settingsSchema = z.object({
  name,
  address: text(500),
  phone: text(40),
  contactEmail: z.union([z.literal(""), emailSchema]).default(""),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid colour."),
  vatRegistered: z.boolean(),
  vatNumber: text(20),
  vatRatePercent: z.coerce.number().min(0).max(100),
  quoteTerms: text(4000),
  quoteValidityDays: z.coerce.number().int().min(1).max(365),
  customerSignoffRequired: z.boolean(),
});

export async function updateOrgSettings(ctx: Ctx, input: z.input<typeof settingsSchema>) {
  requirePerm(ctx, "org.manage");
  const p = settingsSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const { vatRatePercent, ...d } = p.data;
  if (d.vatRegistered && !d.vatNumber) throw invalid("Enter your VAT number, or untick VAT registered.");
  return prisma.$transaction(async (tx) => {
    await tx.organisation.update({ where: { id: ctx.orgId }, data: { ...d, vatRateBps: Math.round(vatRatePercent * 100) } });
    await logEvent(tx, actorOf(ctx), null, "org.settings_changed", "Company settings updated");
  });
}

const ruleSchema = z.array(z.object({
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]),
  responseHours: z.coerce.number().int().min(1).max(8760),
  completionHours: z.coerce.number().int().min(1).max(8760),
}));

export async function setPriorityRules(ctx: Ctx, rules: z.input<typeof ruleSchema>) {
  requirePerm(ctx, "org.manage");
  const p = ruleSchema.safeParse(rules);
  if (!p.success) throw invalid("Response times must be whole hours between 1 and 8760.");
  await prisma.$transaction(p.data.map((r) =>
    prisma.priorityRule.upsert({
      where: { orgId_priority: { orgId: ctx.orgId, priority: r.priority } },
      update: { responseHours: r.responseHours, completionHours: r.completionHours },
      create: { ...r, orgId: ctx.orgId },
    })));
}

// ---------- Team & invitations ----------

const inviteSchema = z.object({
  email: emailSchema,
  name: text(120),
  roles: z.array(z.enum(["OWNER", "MANAGER", "TECHNICIAN", "CLIENT", "REQUESTER"])).min(1, "Choose at least one role."),
  clientId: z.string().uuid().nullish(),
});
export const INVITE_DAYS = 7;

function assertRoleShape(roles: Role[], clientId: string | null | undefined) {
  const staff = roles.some((r) => r === "OWNER" || r === "MANAGER" || r === "TECHNICIAN");
  if (roles.includes("CLIENT") && !clientId) throw invalid("Choose which customer this person represents.");
  // A person tied to a customer organisation can never hold staff roles in the tenant.
  if (clientId && staff) throw invalid("Customer users cannot also be staff.");
}

/** Invite a person. OWNER can invite anyone; MANAGER may invite customer-side users only. Returns the one-time token. */
export async function inviteMember(ctx: Ctx, input: z.input<typeof inviteSchema>) {
  const p = inviteSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  assertRoleShape(d.roles, d.clientId);
  requirePerm(ctx, d.clientId ? "clients.manage" : "team.manage");
  requireVerifiedEmail(ctx);
  const token = newToken();
  return prisma.$transaction(async (tx) => {
    if (d.clientId && !(await tx.client.findFirst({ where: { id: d.clientId, orgId: ctx.orgId } }))) throw notFound("Customer not found.");
    if (await tx.membership.findFirst({ where: { orgId: ctx.orgId, user: { email: d.email } } }))
      throw conflict("This person is already a member.");
    if (!d.clientId) await assertWithinPlan(tx, ctx.orgId, "users");
    await tx.invitation.updateMany({
      where: { orgId: ctx.orgId, email: d.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() },
    });
    const inv = await tx.invitation.create({
      data: {
        orgId: ctx.orgId, email: d.email, name: d.name, roles: d.roles, clientId: d.clientId ?? null,
        tokenHash: hashToken(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
    });
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
    await queueEmail(tx, {
      orgId: ctx.orgId, to: d.email, subject: `You have been invited to ${org.name} on FixRelay`,
      body: `${ctx.userName} invited you to join ${org.name}.\n\nAccept: ${process.env.APP_URL ?? ""}/invite/${token}\n\nThis link expires in ${INVITE_DAYS} days.`,
      dedupeKey: `invite:${inv.id}`,
    });
    await logEvent(tx, actorOf(ctx), null, "team.invited", `Invited ${d.email} as ${d.roles.join(", ")}`);
    return { id: inv.id, token };
  });
}

export async function getInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  const [org, existing] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: inv.orgId }, select: { name: true } }),
    prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }),
  ]);
  return { email: inv.email, name: inv.name, orgName: org.name, roles: inv.roles, hasAccount: !!existing };
}

/**
 * Accept an invitation. New users set a name + password; existing users must prove their password.
 * The invitation is claimed atomically so it can only be accepted once.
 */
export async function acceptInvitation(token: string, input: { name?: string; password: string }) {
  const tokenHash = hashToken(token);
  const inv = await prisma.invitation.findUnique({ where: { tokenHash } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date())
    throw notFound("This invitation is no longer valid. Ask for a new one.");
  let user = await prisma.user.findUnique({ where: { email: inv.email } });
  let passwordHash: string | null = null;
  if (user) {
    const bcrypt = (await import("bcryptjs")).default;
    if (!(await bcrypt.compare(input.password, user.passwordHash))) throw invalid("Incorrect password for your existing account.");
  } else {
    if (!input.name || input.name.trim().length < 2) throw invalid("Enter your name.");
    passwordHash = await hashPassword(input.password);
  }
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw conflict("This invitation has already been used.");
    // The invitation link was delivered to this address, which proves ownership.
    user ??= await tx.user.create({ data: { email: inv.email, name: input.name!.trim(), passwordHash: passwordHash!, emailVerifiedAt: new Date() } });
    await tx.membership.create({ data: { orgId: inv.orgId, userId: user.id, roles: inv.roles, clientId: inv.clientId } });
    await logEvent(tx, { orgId: inv.orgId, userId: user.id, label: user.name }, null, "team.joined", `${user.name} joined`);
    return { userId: user.id, orgId: inv.orgId, token: await createSession(tx, user.id, inv.orgId) };
  });
}

export async function revokeInvitation(ctx: Ctx, id: string) {
  requirePerm(ctx, "team.manage");
  await prisma.invitation.updateMany({ where: { id, orgId: ctx.orgId, acceptedAt: null }, data: { revokedAt: new Date() } });
}

export async function listTeam(ctx: Ctx) {
  requirePerm(ctx, "team.view");
  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { orgId: ctx.orgId },
      include: { user: { select: { id: true, name: true, email: true } }, client: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { orgId: ctx.orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" },
    }),
  ]);
  return { members, invitations };
}

/** Staff who can be given work (active technicians; managers/owners may also do assessments). */
export async function listAssignable(ctx: Ctx, roles: Role[] = ["TECHNICIAN"]) {
  requirePerm(ctx, "clients.view");
  return prisma.membership.findMany({
    where: { orgId: ctx.orgId, active: true, clientId: null, roles: { hasSome: roles } },
    select: { userId: true, roles: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

const memberSchema = z.object({
  roles: z.array(z.enum(["OWNER", "MANAGER", "TECHNICIAN", "CLIENT", "REQUESTER"])).min(1, "Choose at least one role."),
  active: z.boolean(),
});

/** Change a member's roles or deactivate them (access revocation is immediate). The last owner is protected. */
export async function updateMember(ctx: Ctx, membershipId: string, input: z.input<typeof memberSchema>) {
  requirePerm(ctx, "team.manage");
  const p = memberSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  return prisma.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, orgId: ctx.orgId }, include: { user: true } });
    if (!m) throw notFound();
    assertRoleShape(p.data.roles, m.clientId);
    const stillOwner = p.data.active && p.data.roles.includes("OWNER");
    if (m.roles.includes("OWNER") && !stillOwner) {
      // Serialise owner changes so two owners cannot demote each other concurrently.
      await tx.$queryRaw`SELECT id FROM "Organisation" WHERE id = ${ctx.orgId}::uuid FOR UPDATE`;
      const owners = await tx.membership.count({ where: { orgId: ctx.orgId, active: true, roles: { has: "OWNER" } } });
      if (owners <= 1) throw conflict("A company must keep at least one active owner.");
    }
    if (p.data.active && !m.active && !m.clientId) await assertWithinPlan(tx, ctx.orgId, "users");
    await tx.membership.update({ where: { id: m.id }, data: p.data });
    if (!p.data.active) await tx.session.updateMany({ where: { userId: m.userId, activeOrgId: ctx.orgId }, data: { activeOrgId: null } });
    await logEvent(tx, actorOf(ctx), null, "team.member_changed",
      `${m.user.name}: ${p.data.active ? `roles set to ${p.data.roles.join(", ")}` : "access removed"}`);
  });
}

// ---------- Support access (platform operator) ----------

export async function grantSupportAccess(ctx: Ctx, input: { reason: string; hours: number }) {
  requirePerm(ctx, "org.manage");
  const reason = input.reason.trim();
  if (reason.length < 5) throw invalid("Describe why support access is needed.");
  const hours = Math.min(Math.max(Math.round(input.hours), 1), 72);
  return prisma.$transaction(async (tx) => {
    const g = await tx.supportAccessGrant.create({
      data: { orgId: ctx.orgId, grantedById: ctx.userId, reason, expiresAt: new Date(Date.now() + hours * 3_600_000) },
    });
    await logEvent(tx, actorOf(ctx), null, "support.granted", `Support access granted for ${hours}h: ${reason}`);
    return g;
  });
}

export async function revokeSupportAccess(ctx: Ctx, id: string) {
  requirePerm(ctx, "org.manage");
  return prisma.$transaction(async (tx) => {
    const r = await tx.supportAccessGrant.updateMany({ where: { id, orgId: ctx.orgId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count) await logEvent(tx, actorOf(ctx), null, "support.revoked", "Support access revoked");
  });
}

export const listSupportGrants = (ctx: Ctx) =>
  prisma.supportAccessGrant.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 10 });

/** Platform operator opens a tenant. Only succeeds with a live grant; the entry is written to the tenant's audit trail. */
export async function enterSupportSession(user: { id: string; name: string; isPlatformAdmin: boolean }, orgId: string) {
  if (!user.isPlatformAdmin) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const grant = await tx.supportAccessGrant.findFirst({ where: { orgId, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!grant) throw forbidden("This company has not granted support access.");
    await logEvent(tx, { orgId, userId: user.id, label: `${user.name} (platform support)` }, null, "support.accessed",
      "Platform support opened this workspace (read-only)", { grantId: grant.id });
  });
}

/** Platform operator's tenant list: account metadata only, never tenant business data. */
export async function listTenants(user: { isPlatformAdmin: boolean }) {
  if (!user.isPlatformAdmin) throw forbidden();
  return prisma.organisation.findMany({
    where: { isDemo: false },
    select: { id: true, name: true, createdAt: true, subscription: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
  });
}
