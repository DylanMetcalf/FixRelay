/**
 * Employees ask for access with a site registration code. The code only lets someone ASK: it creates a pending
 * request that an administrator approves (choosing the role), after the person has confirmed their email address.
 * Codes can expire, be revoked and be replaced at any time.
 */
import { randomInt, randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import sharp from "sharp";
import { z } from "zod";
import { appUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { createSession, emailSchema, hashPassword, passwordSchema } from "../auth";
import { requirePerm, type Ctx } from "../permissions";
import { sniffMime } from "./attachments";
import { sanitizeImage } from "../scan";
import { storage } from "../storage";
import { sendVerificationEmail } from "./account";
import { actorOf, logEvent } from "./activity";
import { assertWithinPlan } from "./billing";
import { notify, queueEmail } from "./notifications";
import { isSeat } from "./orgs";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const makeCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("");
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

// ---------- Codes (administrators) ----------

export async function createJoinCode(ctx: Ctx, input: { siteId?: string | null; days?: number | null }) {
  requirePerm(ctx, "team.manage");
  const siteId = input.siteId || null;
  if (siteId && !(await prisma.site.findFirst({ where: { id: siteId, orgId: ctx.orgId, archived: false } }))) throw invalid("Choose one of your sites.");
  const days = input.days == null ? 30 : Math.max(1, Math.min(365, Math.round(input.days)));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const c = await tx.joinCode.create({ data: { orgId: ctx.orgId, siteId, code: makeCode(), createdById: ctx.userId, expiresAt: new Date(Date.now() + days * 86_400_000) } });
        await logEvent(tx, actorOf(ctx), null, "joincode.created", `Registration code created${siteId ? " for a site" : ""} (expires in ${days} days)`);
        return c;
      });
    } catch (e) { if (attempt === 4) throw e; }
  }
  throw conflict("Could not create a code. Try again.");
}

export async function listJoinCodes(ctx: Ctx) {
  requirePerm(ctx, "team.manage");
  return prisma.joinCode.findMany({ where: { orgId: ctx.orgId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } });
}

export async function revokeJoinCode(ctx: Ctx, id: string) {
  requirePerm(ctx, "team.manage");
  const r = await prisma.joinCode.updateMany({ where: { id, orgId: ctx.orgId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count !== 1) throw notFound("Code not found.");
}

/** Replace a code: the old one stops working immediately. */
export async function regenerateJoinCode(ctx: Ctx, id: string) {
  const old = await prisma.joinCode.findFirst({ where: { id, orgId: ctx.orgId, revokedAt: null } });
  if (!old) throw notFound("Code not found.");
  await revokeJoinCode(ctx, id);
  return createJoinCode(ctx, { siteId: old.siteId });
}

// ---------- Registration (public) ----------

async function validCode(raw: string) {
  const code = normaliseCode(raw);
  const c = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) ? await prisma.joinCode.findUnique({ where: { code } }) : null;
  if (!c || c.revokedAt || (c.expiresAt && c.expiresAt < new Date())) return null;
  const org = await prisma.organisation.findUnique({ where: { id: c.orgId }, select: { id: true, name: true, archivedAt: true, isDemo: true } });
  if (!org || org.archivedAt) return null;
  return { c, org };
}

/** What the registration page shows for a code: company, site and departments. Nothing else is revealed. */
export async function lookupJoinCode(raw: string) {
  const v = await validCode(raw);
  if (!v) return null;
  const [site, departments] = await Promise.all([
    v.c.siteId ? prisma.site.findUnique({ where: { id: v.c.siteId }, select: { name: true } }) : null,
    prisma.department.findMany({ where: { orgId: v.org.id, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { code: v.c.code, orgName: v.org.name, siteName: site?.name ?? null, departments };
}

const registerSchema = z.object({
  code: z.string().min(8).max(12),
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: emailSchema,
  password: passwordSchema,
  departmentId: z.string().uuid().nullable().default(null),
  jobTitle: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
});

async function storePhoto(orgId: string, bytes: Buffer): Promise<string> {
  if (bytes.length > 5 * 1024 * 1024) throw invalid("The photo must be 5 MB or smaller.");
  const mime = sniffMime(bytes);
  if (!mime || mime === "application/pdf") throw invalid("The profile photo must be a JPEG, PNG or WebP image.");
  const clean = await sanitizeImage(bytes, mime); // strips location data
  const small = await sharp(clean).resize(256, 256, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
  const key = `${orgId}/${randomUUID()}`;
  await storage().put(key, small, "image/jpeg");
  return key;
}

/**
 * Ask to join a company with its code. Creates the account (unconfirmed email) and a PENDING request, emails a
 * confirmation link, and tells the administrators. Returns a session so the person sees their request status.
 */
export async function registerWithCode(input: z.input<typeof registerSchema>, photo?: Buffer | null) {
  const p = registerSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  const v = await validCode(d.code);
  if (!v) throw invalid("That registration code is not valid. Check it with your site administrator; codes can expire or be replaced.");
  if (d.departmentId && !(await prisma.department.findFirst({ where: { id: d.departmentId, orgId: v.org.id, archived: false } }))) throw invalid("Choose one of the departments.");
  if (await prisma.user.findUnique({ where: { email: d.email } }))
    throw conflict("This email address already has a Resultra account. Sign in first, or ask your administrator to invite you.");
  const passwordHash = await hashPassword(d.password);
  const photoKey = photo?.length ? await storePhoto(v.org.id, photo) : null;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: d.email, name: d.name, passwordHash, jobTitle: d.jobTitle, phone: d.phone, photoKey } });
    const m = await tx.membership.create({ data: {
      orgId: v.org.id, userId: user.id, roles: ["REQUESTER"], siteIds: v.c.siteId ? [v.c.siteId] : [], active: false, status: "PENDING",
      joinCodeId: v.c.id, requestedDepartmentId: d.departmentId,
    } });
    await tx.joinCode.update({ where: { id: v.c.id }, data: { uses: { increment: 1 } } });
    await sendVerificationEmail(tx, user);
    await logEvent(tx, { orgId: v.org.id, userId: user.id, label: user.name }, null, "team.requested", `${user.name} (${user.email}) asked to join with a registration code`);
    const admins = (await tx.membership.findMany({ where: { orgId: v.org.id, active: true, roles: { has: "OWNER" } }, select: { userId: true } })).map((x) => x.userId);
    await notify(tx, {
      orgId: v.org.id, type: "team.requested", userIds: admins, title: `${user.name} asked to join ${v.org.name}`,
      body: `${user.name}${d.jobTitle ? `, ${d.jobTitle}` : ""} (${user.email}) registered with a site code. Review the request in Settings → Waiting for approval:\n${appUrl()}/settings#approvals`,
      eventKey: `requested:${m.id}`,
    });
    return { userId: user.id, orgId: v.org.id, token: await createSession(tx, user.id, v.org.id) };
  });
}

// ---------- Approval (administrators) ----------

export async function listPendingMembers(ctx: Ctx) {
  requirePerm(ctx, "team.manage");
  const rows = await prisma.membership.findMany({
    where: { orgId: ctx.orgId, status: "PENDING" }, orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true, jobTitle: true, phone: true, photoKey: true, emailVerifiedAt: true } } },
  });
  return rows;
}

const approveSchema = z.object({
  roles: z.array(z.enum(["OWNER", "MANAGER", "APPROVER", "TECHNICIAN", "STORES", "REQUESTER"])).min(1, "Choose at least one role."),
  departmentId: z.string().uuid().nullable().default(null),
  departmentManager: z.boolean().default(false),
});

export async function approveMember(ctx: Ctx, membershipId: string, input: z.input<typeof approveSchema>) {
  requirePerm(ctx, "team.manage");
  const p = approveSchema.safeParse(input);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  const d = p.data;
  return prisma.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, orgId: ctx.orgId, status: "PENDING" }, include: { user: true } });
    if (!m) throw notFound("This request was already handled.");
    if (!m.user.emailVerifiedAt) throw conflict(`${m.user.name} has not confirmed their email address yet. Ask them to use the link we emailed them.`);
    if (d.departmentId && !(await tx.department.findFirst({ where: { id: d.departmentId, orgId: ctx.orgId, archived: false } }))) throw invalid("Choose one of your departments.");
    if (isSeat(d.roles as Role[])) await assertWithinPlan(tx, ctx.orgId, "users");
    const r = await tx.membership.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "ACTIVE", active: true, roles: d.roles as Role[] } });
    if (r.count !== 1) throw conflict("This request was already handled.");
    if (d.departmentId) await tx.departmentMember.upsert({
      where: { departmentId_userId: { departmentId: d.departmentId, userId: m.userId } },
      create: { orgId: ctx.orgId, departmentId: d.departmentId, userId: m.userId, isManager: d.departmentManager },
      update: { isManager: d.departmentManager },
    });
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
    await queueEmail(tx, {
      orgId: ctx.orgId, to: m.user.email, subject: `Your access to ${org.name} on Resultra was approved`, dedupeKey: `approved:${m.id}`,
      body: `Hi ${m.user.name},\n\n${ctx.userName} approved your access to ${org.name}. Sign in to start:\n${appUrl()}/dashboard`,
    });
    await logEvent(tx, actorOf(ctx), null, "team.approved", `Approved ${m.user.name} as ${d.roles.join(", ").toLowerCase()}`);
  });
}

export async function rejectMember(ctx: Ctx, membershipId: string, input: { reason?: string }) {
  requirePerm(ctx, "team.manage");
  return prisma.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, orgId: ctx.orgId, status: "PENDING" }, include: { user: true } });
    if (!m) throw notFound("This request was already handled.");
    await tx.membership.update({ where: { id: m.id }, data: { status: "REJECTED", active: false } });
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
    await queueEmail(tx, {
      orgId: ctx.orgId, to: m.user.email, subject: `Your request to join ${org.name} on Resultra`, dedupeKey: `rejected:${m.id}`,
      body: `Hi ${m.user.name},\n\nYour request to join ${org.name} was not approved.${input.reason?.trim() ? ` Reason: ${input.reason.trim().slice(0, 300)}` : ""} If you think this is a mistake, contact your site administrator.`,
    });
    await logEvent(tx, actorOf(ctx), null, "team.rejected", `Declined the access request from ${m.user.name}`);
  });
}

/** The signed-in person's own pending request (shown while they wait). */
export async function myPendingRequest(userId: string) {
  const m = await prisma.membership.findFirst({ where: { userId, status: "PENDING" }, include: { org: { select: { name: true } }, user: { select: { emailVerifiedAt: true, email: true } } } });
  return m ? { orgName: m.org.name, emailVerified: !!m.user.emailVerifiedAt, email: m.user.email, requestedAt: m.createdAt } : null;
}

/** People keep their own job title, phone number and photo up to date. */
export async function updateMyProfile(ctx: Ctx, input: { name: string; jobTitle: string; phone: string }, photo?: Buffer | null) {
  const d = z.object({ name: z.string().trim().min(2, "Enter your name.").max(120), jobTitle: z.string().trim().max(80), phone: z.string().trim().max(40) }).safeParse(input);
  if (!d.success) throw invalid(d.error.issues[0]!.message);
  const photoKey = photo?.length ? await storePhoto(ctx.orgId, photo) : undefined;
  await prisma.user.update({ where: { id: ctx.userId }, data: { ...d.data, ...(photoKey ? { photoKey } : {}) } });
}
