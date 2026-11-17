/**
 * Maintenance reports / jobs for the organisation's own sites: logging (in-app and public link), triage,
 * assessment, routing (in-house or contractor), in-house assignment and execution, completion, confirmation
 * that it is fixed, closure. Contractor quoting/approval lives in quotes.ts / approvals.ts / portal.ts.
 * Rules enforced here (see WORKFLOWS.md):
 *  - every read goes through jobScope(ctx); every write checks a permission first;
 *  - status only changes via `move`, a guarded UPDATE that fails if the job changed concurrently;
 *  - each change writes an audit event in the same transaction.
 */
import type { JobStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { can, isManager, isStaff, jobScope, requirePerm, type Ctx } from "../permissions";
import { issueCompletionLink, revokeJobLinks } from "./contractor-links";
import { assertTransition, OPEN_STATUSES, REQUEST_STATUSES } from "../workflow";
import { actorOf, logEvent } from "./activity";
import { assertWithinPlan } from "./billing";
import { managerIds, notify, queueEmail } from "./notifications";
import { findSite } from "./sites";

const parse = <T extends z.ZodTypeAny>(s: T, v: unknown): z.output<T> => {
  const p = s.safeParse(v);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  return p.data;
};
const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().uuid().nullable());
const optDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable());
const reason = z.string().trim().min(3, "Please give a reason.").max(1000);
const priority = z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
export const CATEGORIES = ["General", "Electrical", "Mechanical", "Plumbing", "HVAC", "Building", "Safety", "Other"] as const;

/** Guarded status change: succeeds only if the job is still in the status we read. */
export async function move(tx: Tx, orgId: string, job: { id: string; status: JobStatus }, to: JobStatus, data: Prisma.JobUncheckedUpdateManyInput = {}) {
  assertTransition(job.status, to);
  const first = job.status === "NEW" ? { respondedAt: new Date() } : {};
  const r = await tx.job.updateMany({ where: { id: job.id, orgId, status: job.status }, data: { ...data, ...first, status: to } });
  if (r.count !== 1) throw conflict("This job was just changed by someone else. Refresh and try again.");
}

export async function loadJob(tx: Tx, ctx: Ctx, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Job not found.");
  const job = await tx.job.findFirst({ where: { id, ...jobScope(ctx) }, include: { technicians: true } });
  if (!job) throw notFound("Job not found.");
  return job;
}
type LoadedJob = Awaited<ReturnType<typeof loadJob>>;

export type JobRecord = LoadedJob;
export const isAssigned = (job: { leadTechnicianId: string | null; technicians: { userId: string }[] }, userId: string) =>
  job.leadTechnicianId === userId || job.technicians.some((t) => t.userId === userId);

/** Managers may act on any job; technicians only on jobs they are assigned to. */
function requireOnJob(ctx: Ctx, job: LoadedJob) {
  if (!isManager(ctx) && !isAssigned(job, ctx.userId)) throw forbidden("You are not assigned to this job.");
}

const assignees = (job: LoadedJob) => [job.leadTechnicianId, ...job.technicians.map((t) => t.userId)];

// ---------- Logging ----------

const createSchema = z.object({
  title: z.string().trim().min(3, "Say what the problem is in a few words.").max(160),
  description: z.string().trim().min(3, "Describe the problem.").max(5000),
  siteId: z.string().uuid("Choose a site."),
  locationId: optId, assetId: optId,
  category: z.enum(CATEGORIES).default("General"),
  priority: priority.default("NORMAL"),
  emergency: z.boolean().default(false),
});

async function insertJob(tx: Tx, orgId: string, d: z.output<typeof createSchema>, extra: Partial<Prisma.JobUncheckedCreateInput>) {
  if (d.locationId && !(await tx.location.findFirst({ where: { id: d.locationId, orgId, siteId: d.siteId } })))
    throw invalid("That location is not at the selected site.");
  if (d.assetId && !(await tx.asset.findFirst({ where: { id: d.assetId, orgId, siteId: d.siteId } })))
    throw invalid("That equipment is not at the selected site.");
  await assertWithinPlan(tx, orgId, "activeJobs");
  // Incrementing the counter locks the organisation row, so references are gap-free and unique.
  const org = await tx.organisation.update({ where: { id: orgId }, data: { jobSeq: { increment: 1 } } });
  const rule = await tx.priorityRule.findUnique({ where: { orgId_priority: { orgId, priority: d.priority } } });
  const now = new Date();
  return tx.job.create({
    data: {
      ...d, orgId, reference: `REQ-${String(org.jobSeq).padStart(5, "0")}`, reportedAt: now,
      reporterConfirmation: org.reporterConfirmation, dueAt: rule ? new Date(now.getTime() + rule.completionHours * 3_600_000) : null,
      ...extra,
    },
  });
}

/** Log a fault from inside the app (any member, for a site they belong to). */
export async function createJob(ctx: Ctx, input: z.input<typeof createSchema>) {
  requirePerm(ctx, "job.create");
  const d = parse(createSchema, input);
  const site = await findSite(ctx, d.siteId);
  if (!site || site.archived) throw invalid("Choose one of your sites.");
  return prisma.$transaction(async (tx) => {
    const job = await insertJob(tx, ctx.orgId, d, { requesterId: ctx.userId, source: "APP" });
    await logEvent(tx, actorOf(ctx), job.id, "job.created", `Fault reported: ${job.title}`, { priority: d.priority, emergency: d.emergency });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.created", userIds: await managerIds(tx, ctx.orgId), exceptUserId: ctx.userId,
      title: `${d.emergency ? "EMERGENCY: " : ""}New fault ${job.reference} at ${site.name}`, body: job.title, eventKey: `job-created:${job.id}`,
    });
    return job;
  });
}

const publicSchema = createSchema.omit({ siteId: true, emergency: true, category: true, priority: true }).extend({
  reporterName: z.string().trim().min(2, "Enter your name.").max(120),
  reporterPhone: z.string().trim().min(6, "Enter a phone number so the maintenance team can reach you.").max(40),
  reporterEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email address, or leave it empty.")]).default(""),
});
export type PublicReportInput = z.input<typeof publicSchema>;

/**
 * Report a fault WITHOUT an account, from a site's public link or a QR code. Only works when the organisation
 * has switched public reporting on. The report is marked as unverified for the maintenance team to screen;
 * the reporter cannot see anything else in the system.
 */
export async function createPublicReport(siteToken: string, input: PublicReportInput) {
  const d = parse(publicSchema, input);
  const site = await prisma.site.findUnique({ where: { publicToken: siteToken } });
  const org = site ? await prisma.organisation.findUnique({ where: { id: site.orgId }, include: { subscription: { include: { plan: true } } } }) : null;
  if (!site || site.archived || !org?.publicReportingEnabled) throw notFound("This report link is not active. Please contact the site's maintenance team.");
  return prisma.$transaction(async (tx) => {
    const job = await insertJob(tx, site.orgId, { ...d, siteId: site.id, category: "General", priority: "NORMAL", emergency: false }, {
      requesterId: null, source: "PUBLIC_LINK", reporterConfirmation: false,
      reporterName: d.reporterName, reporterPhone: d.reporterPhone, reporterEmail: d.reporterEmail || null,
    });
    const actor = { orgId: site.orgId, userId: null, label: `${d.reporterName} (public report link)` };
    await logEvent(tx, actor, job.id, "job.created", `Fault reported through the public link: ${job.title}`, { source: "PUBLIC_LINK" });
    await notify(tx, {
      orgId: site.orgId, jobId: job.id, type: "job.created", userIds: await managerIds(tx, site.orgId),
      title: `New public report ${job.reference} at ${site.name} – please screen`, body: `${job.title}\nFrom ${d.reporterName}, ${d.reporterPhone}`, eventKey: `job-created:${job.id}`,
    });
    if (d.reporterEmail)
      await queueEmail(tx, {
        orgId: site.orgId, to: d.reporterEmail, subject: `We received your fault report ${job.reference}`, dedupeKey: `public-ack:${job.id}`,
        body: `Hi ${d.reporterName},\n\nThank you. Your report "${job.title}" at ${site.name} was received as ${job.reference}. The maintenance team will look at it and may contact you on ${d.reporterPhone}.`,
      });
    return { reference: job.reference };
  });
}

// ---------- Reading ----------

const CUSTOMER_VISIBLE_KINDS = ["REQUEST", "QUOTE", "BEFORE", "AFTER", "TEST_DOCUMENT", "SIGNATURE"] as const;

/** Full job view. Internal working data is removed for customer-side users HERE, not in the UI. */
export async function getJob(ctx: Ctx, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Job not found.");
  const staff = isStaff(ctx);
  const seePrices = can(ctx, "quote.view");
  const job = await prisma.job.findFirst({
    where: { id, ...jobScope(ctx) },
    include: {
      site: { select: { id: true, name: true, address: true } },
      contractor: { select: { id: true, name: true, email: true, phone: true, contactName: true } },
      contractorLinks: { where: { revokedAt: null }, select: { id: true, purpose: true, contractorId: true, expiresAt: true, usedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      location: { select: { name: true } },
      asset: { select: { id: true, name: true, reference: true } },
      technicians: true,
      assessments: { orderBy: { createdAt: "desc" } },
      quotes: { include: { lines: { orderBy: { position: "asc" } }, decision: true, contractor: { select: { id: true, name: true } } }, orderBy: [{ totalCents: "asc" }] },
      updates: { orderBy: { createdAt: "desc" } },
      completions: { include: { decision: true }, orderBy: { version: "desc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!job) throw notFound("Job not found.");
  if (!seePrices) { job.quotes = []; job.approvedCostCents = null; job.contractorLinks = []; }
  if (!staff) {
    // Requesters see progress, not internal working notes, prices or contractor details.
    job.reporterPhone = null;
    job.reporterEmail = null;
    job.assessments = [];
    job.updates = [];
    job.instructions = null;
    job.quotes = job.quotes.filter((q) => q.status !== "DRAFT" && q.status !== "WITHDRAWN");
    job.attachments = job.attachments.filter((a) => (CUSTOMER_VISIBLE_KINDS as readonly string[]).includes(a.kind));
    job.events = job.events.filter((e) => !e.type.startsWith("work.") && !e.type.startsWith("assessment."));
  }
  const ids = new Set<string>([job.requesterId ?? "", ...job.events.map((e) => e.actorUserId ?? "")]);
  for (const x of [job.ownerId, job.leadTechnicianId, ...job.technicians.map((t) => t.userId), ...job.updates.map((u) => u.authorId),
    ...job.assessments.map((a) => a.authorId), ...job.completions.map((c) => c.submittedById)]) if (x) ids.add(x);
  ids.delete("");
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  return { ...job, people: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>, assigned: isAssigned(job, ctx.userId) };
}
export type JobView = Awaited<ReturnType<typeof getJob>>;

export interface JobFilters {
  view?: "requests" | "jobs" | "mine" | "all";
  status?: JobStatus; siteId?: string; technicianId?: string; contractorId?: string; route?: string; source?: string;
  priority?: string; from?: string; to?: string; overdue?: boolean; q?: string;
}

function filterWhere(ctx: Ctx, f: JobFilters): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [jobScope(ctx)];
  const uuid = (v?: string) => (v && z.string().uuid().safeParse(v).success ? v : undefined);
  const date = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
  if (f.view === "requests") and.push({ status: { in: REQUEST_STATUSES } });
  if (f.view === "jobs") and.push({ status: { notIn: REQUEST_STATUSES } });
  if (f.view === "mine") and.push({ status: { in: OPEN_STATUSES }, OR: [{ leadTechnicianId: ctx.userId }, { technicians: { some: { userId: ctx.userId } } }] });
  if (f.status && f.status in { NEW: 1, ASSESSING: 1, ASSESSED: 1, QUOTING: 1, AWAITING_APPROVAL: 1, APPROVED: 1, ASSIGNED: 1, IN_PROGRESS: 1, ON_HOLD: 1, AWAITING_VERIFICATION: 1, VERIFIED: 1, CLOSED: 1, CANCELLED: 1 }) and.push({ status: f.status });
  if (uuid(f.contractorId)) and.push({ contractorId: f.contractorId });
  if (f.route === "IN_HOUSE" || f.route === "CONTRACTOR" || f.route === "UNDECIDED") and.push({ route: f.route });
  if (f.source === "PUBLIC_LINK") and.push({ source: "PUBLIC_LINK" });
  if (uuid(f.siteId)) and.push({ siteId: f.siteId });
  if (uuid(f.technicianId)) and.push({ OR: [{ leadTechnicianId: f.technicianId }, { technicians: { some: { userId: f.technicianId } } }] });
  if (priority.safeParse(f.priority).success) and.push({ priority: f.priority as "LOW" });
  if (date(f.from)) and.push({ reportedAt: { gte: date(f.from) } });
  if (date(f.to)) and.push({ reportedAt: { lt: new Date(date(f.to)!.getTime() + 86_400_000) } });
  if (f.overdue) and.push({ status: { in: OPEN_STATUSES }, dueAt: { lt: new Date() } });
  if (f.q?.trim()) and.push({ OR: [{ title: { contains: f.q.trim(), mode: "insensitive" } }, { reference: { contains: f.q.trim(), mode: "insensitive" } }] });
  return { AND: and };
}

export async function listJobs(ctx: Ctx, f: JobFilters = {}, take = 100) {
  const jobs = await prisma.job.findMany({
    where: filterWhere(ctx, f),
    select: {
      id: true, reference: true, title: true, status: true, priority: true, emergency: true, dueAt: true, reportedAt: true,
      reporterConfirmation: true, leadTechnicianId: true, plannedStart: true, closedAt: true, route: true, source: true,
      contractorId: true, contractor: { select: { name: true } }, site: { select: { name: true } }, location: { select: { name: true } },
    },
    orderBy: [{ emergency: "desc" }, { reportedAt: "desc" }], take,
  });
  const ids = [...new Set(jobs.map((j) => j.leadTechnicianId).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return jobs.map((j) => ({ ...j, technicianName: j.leadTechnicianId ? (names[j.leadTechnicianId] ?? null) : null }));
}
export type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

/** Dashboard queue counts. Every number is a COUNT of real job rows visible to the viewer under the same filters. */
export async function dashboardCounts(ctx: Ctx, f: JobFilters = {}) {
  const where = filterWhere(ctx, { ...f, view: "all", status: undefined });
  const now = new Date();
  const [byStatus, overdue, unowned, recentlyClosed, toScreen] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], where, _count: true }),
    prisma.job.count({ where: { AND: [where, { status: { in: OPEN_STATUSES }, dueAt: { lt: now } }] } }),
    prisma.job.count({ where: { AND: [where, { status: "NEW", ownerId: null }] } }),
    prisma.job.count({ where: { AND: [where, { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }] } }),
    prisma.job.count({ where: { AND: [where, { status: "NEW", source: "PUBLIC_LINK" }] } }),
  ]);
  const n = (s: JobStatus) => byStatus.find((x) => x.status === s)?._count ?? 0;
  return {
    newRequests: n("NEW"), unowned, awaitingAssessment: n("ASSESSING"), assessed: n("ASSESSED"), quoting: n("QUOTING"),
    awaitingApproval: n("AWAITING_APPROVAL"), awaitingAssignment: n("APPROVED"), assigned: n("ASSIGNED"),
    inProgress: n("IN_PROGRESS"), onHold: n("ON_HOLD"), awaitingVerification: n("AWAITING_VERIFICATION"),
    readyToClose: n("VERIFIED"), overdue, recentlyClosed, toScreen,
  };
}

// ---------- Triage ----------

export async function changePriority(ctx: Ctx, jobId: string, value: string) {
  requirePerm(ctx, "job.manage");
  const p = parse(priority, value);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (!OPEN_STATUSES.includes(job.status)) throw conflict("This job is no longer open.");
    if (job.priority === p) return;
    await tx.job.update({ where: { id: job.id }, data: { priority: p } });
    await logEvent(tx, actorOf(ctx), job.id, "job.priority_changed", `Priority changed from ${job.priority} to ${p}`);
  });
}

export async function setSignoffRequired(ctx: Ctx, jobId: string, required: boolean) {
  requirePerm(ctx, "job.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (["AWAITING_VERIFICATION", "VERIFIED", "CLOSED", "CANCELLED"].includes(job.status))
      throw conflict("This can't change once work has been submitted.");
    if (required && !job.requesterId) throw conflict("This fault was reported without an account, so the reporter cannot confirm it in the app. Capture their signature on site instead.");
    const r = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data: { reporterConfirmation: required } });
    if (r.count !== 1) throw conflict("This job was just changed by someone else. Refresh and try again.");
    await logEvent(tx, actorOf(ctx), job.id, "job.signoff_rule_changed", `Reporter confirmation ${required ? "required" : "not required"} for this job`);
  });
}

async function assertStaffMembers(tx: Tx, orgId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  const n = await tx.membership.count({
    where: { orgId, userId: { in: ids }, active: true, roles: { hasSome: ["TECHNICIAN", "MANAGER", "OWNER"] } },
  });
  if (n !== ids.length) throw invalid("Choose active team members only.");
}

/** NEW → ASSESSING, optionally naming who must assess. The caller becomes the responsible manager. */
export async function requestAssessment(ctx: Ctx, jobId: string, input: { assessorId?: string | null }) {
  requirePerm(ctx, "job.manage");
  const assessorId = parse(optId, input.assessorId);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (assessorId) await assertStaffMembers(tx, ctx.orgId, [assessorId]);
    await move(tx, ctx.orgId, job, "ASSESSING", { ownerId: job.ownerId ?? ctx.userId, leadTechnicianId: assessorId });
    await logEvent(tx, actorOf(ctx), job.id, "job.assessment_requested", "Sent for assessment", { assessorId });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.assessment_requested", userIds: [assessorId], exceptUserId: ctx.userId,
      title: `Assess ${job.reference}`, body: job.title, eventKey: `assess:${job.id}:${job.reopenCount}`,
    });
  });
}

const assessmentSchema = z.object({
  findings: z.string().trim().min(3, "Record what you found.").max(5000),
  suspectedCause: z.string().trim().max(2000).default(""),
  recommendedWork: z.string().trim().max(5000).default(""),
  materials: z.string().trim().max(2000).default(""),
  labourHoursEstimate: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().min(0).max(100000).nullable()),
  quoteRequired: z.boolean(),
  externalHelpRequired: z.boolean().default(false),
});

/** Record an assessment → ASSESSED. A manager may assess a NEW request directly. */
export async function submitAssessment(ctx: Ctx, jobId: string, input: z.input<typeof assessmentSchema>) {
  requirePerm(ctx, "job.assess");
  const d = parse(assessmentSchema, input);
  return prisma.$transaction(async (tx) => {
    let job = await loadJob(tx, ctx, jobId);
    requireOnJob(ctx, job);
    if (job.status === "NEW" && isManager(ctx)) {
      await move(tx, ctx.orgId, job, "ASSESSING", { ownerId: job.ownerId ?? ctx.userId });
      job = { ...job, status: "ASSESSING" };
    }
    await move(tx, ctx.orgId, job, "ASSESSED");
    const a = await tx.assessment.create({ data: { ...d, orgId: ctx.orgId, jobId: job.id, authorId: ctx.userId } });
    await logEvent(tx, actorOf(ctx), job.id, "assessment.submitted", "Assessment completed", { quoteRequired: d.quoteRequired, assessmentId: a.id });
    await logEvent(tx, actorOf(ctx), job.id, "job.assessed", `Assessment completed – ${d.quoteRequired ? "quotation required" : "no quotation required"}`);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.assessed", userIds: await managerIds(tx, ctx.orgId), exceptUserId: ctx.userId,
      title: `${job.reference} has been assessed`, body: job.title, eventKey: `assessed:${a.id}`,
    });
    return a;
  });
}

/**
 * Route the job to the IN-HOUSE team: ASSESSED/QUOTING → APPROVED (then assign a technician).
 * Also allowed straight from NEW for emergencies. Switching from QUOTING withdraws open quote requests.
 */
export async function routeInHouse(ctx: Ctx, jobId: string, input: { note?: string } = {}) {
  requirePerm(ctx, "job.manage");
  const note = (input.note ?? "").trim().slice(0, 1000);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (!["NEW", "ASSESSED", "QUOTING"].includes(job.status)) throw conflict("This job can't be given to the in-house team at this stage.");
    if (job.status === "NEW" && !job.emergency) throw conflict("Assess the fault first. Only emergencies can skip assessment.");
    await move(tx, ctx.orgId, job, "APPROVED", { route: "IN_HOUSE", directAuthReason: note || null, ownerId: job.ownerId ?? ctx.userId });
    if (job.status === "QUOTING") await withdrawOpenQuotes(tx, ctx, job.id, "The site decided to do this work in-house.");
    await logEvent(tx, actorOf(ctx), job.id, "job.routed_in_house", `To be fixed by the in-house team${note ? `: ${note}` : ""}`);
  });
}

/** Withdraw open quotes and quote links for a job, and tell the invited contractors. */
export async function withdrawOpenQuotes(tx: Tx, ctx: Ctx, jobId: string, why: string) {
  await tx.quote.updateMany({ where: { jobId, orgId: ctx.orgId, status: { in: ["DRAFT", "SUBMITTED"] } }, data: { status: "WITHDRAWN" } });
  const invited = await tx.contractorLink.findMany({ where: { orgId: ctx.orgId, jobId, purpose: "QUOTE", revokedAt: null }, include: { contractor: true, job: true } });
  await revokeJobLinks(tx, ctx.orgId, jobId, "QUOTE");
  for (const l of invited)
    await queueEmail(tx, {
      orgId: ctx.orgId, to: l.contractor.email, subject: `Quote request ${l.job.reference} is no longer needed`, dedupeKey: `rfq-withdrawn:${l.id}`,
      body: `Hello ${l.contractor.contactName || l.contractor.name},\n\nThe quote request "${l.job.title}" (${l.job.reference}) has been closed: ${why}\n\nThank you for your time.`,
    });
}

// ---------- Assignment ----------

const assignSchema = z.object({
  leadTechnicianId: z.string().uuid("Choose the responsible technician."),
  additionalIds: z.array(z.string().uuid()).max(20).default([]),
  plannedStart: optDate, plannedEnd: optDate,
  instructions: z.string().trim().max(5000).default(""),
});

/** APPROVED → ASSIGNED, or re-plan a job that is already assigned / in progress / on hold. */
export async function assignJob(ctx: Ctx, jobId: string, input: z.input<typeof assignSchema>) {
  requirePerm(ctx, "job.manage");
  const d = parse(assignSchema, input);
  if (d.plannedStart && d.plannedEnd && d.plannedEnd < d.plannedStart) throw invalid("Planned completion cannot be before the planned start.");
  const extra = [...new Set(d.additionalIds.filter((x) => x !== d.leadTechnicianId))];
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (job.route === "CONTRACTOR") throw conflict("This job is with an external contractor. Change the route to in-house first.");
    await assertStaffMembers(tx, ctx.orgId, [d.leadTechnicianId, ...extra]);
    const data = {
      leadTechnicianId: d.leadTechnicianId, plannedStart: d.plannedStart,
      plannedEnd: d.plannedEnd, instructions: d.instructions || null, ownerId: job.ownerId ?? ctx.userId,
      ...(d.plannedEnd ? { dueAt: d.plannedEnd, overdueNotifiedAt: null } : {}),
    };
    if (job.status === "APPROVED") await move(tx, ctx.orgId, job, "ASSIGNED", { ...data, route: "IN_HOUSE", assignedAt: job.assignedAt ?? new Date() });
    else if (["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(job.status)) {
      const r = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data });
      if (r.count !== 1) throw conflict("This job was just changed by someone else. Refresh and try again.");
    } else throw conflict("Work must be approved before it can be assigned.");
    await tx.jobTechnician.deleteMany({ where: { jobId: job.id } });
    await tx.jobTechnician.createMany({ data: extra.map((userId) => ({ orgId: ctx.orgId, jobId: job.id, userId })) });
    const lead = await tx.user.findUniqueOrThrow({ where: { id: d.leadTechnicianId }, select: { name: true } });
    await logEvent(tx, actorOf(ctx), job.id, "job.assigned", `Assigned to ${lead.name}${extra.length ? ` and ${extra.length} more` : ""}`,
      { leadTechnicianId: d.leadTechnicianId, additionalIds: extra, plannedStart: d.plannedStart?.toISOString() ?? null, plannedEnd: d.plannedEnd?.toISOString() ?? null });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.assigned", userIds: [d.leadTechnicianId, ...extra], exceptUserId: ctx.userId,
      title: `You have been assigned ${job.reference}`, body: job.title, eventKey: `assigned:${job.id}:${Date.now()}`,
    });
  });
}

// ---------- Execution ----------

export async function startWork(ctx: Ctx, jobId: string) {
  requirePerm(ctx, "job.work");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    requireOnJob(ctx, job);
    if (job.status !== "ASSIGNED") throw conflict("Only an assigned job can be started.");
    await move(tx, ctx.orgId, job, "IN_PROGRESS", { startedAt: job.startedAt ?? new Date() });
    await logEvent(tx, actorOf(ctx), job.id, "job.started", "Work started");
  });
}

const updateSchema = z.object({
  kind: z.enum(["PROGRESS", "NOTE", "CLARIFICATION", "ADDITIONAL_WORK"]).default("PROGRESS"),
  note: z.string().trim().min(2, "Write a short update.").max(5000),
  labourMinutes: z.coerce.number().int().min(0).max(100000).default(0),
  materialDescription: z.string().trim().max(500).default(""),
  materialCostCents: z.number().int().min(0).max(2_000_000_000).default(0),
});

/** Timestamped activity on a job (supports multiple visits). Flags managers for clarification / additional work. */
export async function addWorkUpdate(ctx: Ctx, jobId: string, input: z.input<typeof updateSchema>) {
  requirePerm(ctx, "job.work");
  const d = parse(updateSchema, input);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    requireOnJob(ctx, job);
    if (!["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(job.status)) throw conflict("Updates can only be added while a job is assigned or in progress.");
    const u = await tx.workUpdate.create({ data: { ...d, orgId: ctx.orgId, jobId: job.id, authorId: ctx.userId } });
    const label = { PROGRESS: "Progress update added", NOTE: "Work note added", CLARIFICATION: "Clarification requested", ADDITIONAL_WORK: "Additional work identified – needs approval" }[d.kind];
    await logEvent(tx, actorOf(ctx), job.id, "work.update", label, { updateId: u.id, kind: d.kind });
    if (d.kind === "CLARIFICATION" || d.kind === "ADDITIONAL_WORK") {
      // Additional work changes the authorised commercial scope: a manager must raise a variation quote.
      await logEvent(tx, actorOf(ctx), job.id, d.kind === "ADDITIONAL_WORK" ? "job.additional_work_flagged" : "job.clarification_requested", label);
      await notify(tx, {
        orgId: ctx.orgId, jobId: job.id, type: `work.${d.kind.toLowerCase()}`, userIds: await managerIds(tx, ctx.orgId), exceptUserId: ctx.userId,
        title: `${job.reference}: ${label}`, body: d.note.slice(0, 300), eventKey: `update:${u.id}`,
      });
    } else if (!isAssigned(job, ctx.userId)) {
      // A manager replying on the job (e.g. answering a clarification) alerts the technicians doing the work.
      await notify(tx, {
        orgId: ctx.orgId, jobId: job.id, type: "work.manager_note", userIds: assignees(job), exceptUserId: ctx.userId,
        title: `${job.reference}: new note from ${ctx.userName}`, body: d.note.slice(0, 300), eventKey: `update:${u.id}`,
      });
    }
    return u;
  });
}

export async function holdJob(ctx: Ctx, jobId: string, input: { reason: string }) {
  requirePerm(ctx, "job.work");
  const why = parse(reason, input.reason);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    requireOnJob(ctx, job);
    await move(tx, ctx.orgId, job, "ON_HOLD", { heldFromStatus: job.status, holdReason: why });
    await logEvent(tx, actorOf(ctx), job.id, "job.on_hold", `Put on hold: ${why}`);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.on_hold", userIds: await managerIds(tx, ctx.orgId), exceptUserId: ctx.userId,
      title: `${job.reference} is on hold`, body: why, eventKey: `hold:${job.id}:${Date.now()}`,
    });
  });
}

export async function resumeJob(ctx: Ctx, jobId: string) {
  requirePerm(ctx, "job.work");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    requireOnJob(ctx, job);
    if (job.status !== "ON_HOLD") throw conflict("This job is not on hold.");
    const to = job.heldFromStatus === "IN_PROGRESS" ? "IN_PROGRESS" : "ASSIGNED";
    await move(tx, ctx.orgId, job, to, { heldFromStatus: null, holdReason: null });
    await logEvent(tx, actorOf(ctx), job.id, "job.resumed", "Work resumed");
  });
}

export async function cancelJob(ctx: Ctx, jobId: string, input: { reason: string }) {
  requirePerm(ctx, "job.manage");
  const why = parse(reason, input.reason);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    await move(tx, ctx.orgId, job, "CANCELLED", { cancelReason: why });
    // Nothing may be approved or submitted against a cancelled job.
    await withdrawOpenQuotes(tx, ctx, job.id, `the job was cancelled (${why}).`);
    await revokeJobLinks(tx, ctx.orgId, job.id);
    await logEvent(tx, actorOf(ctx), job.id, "job.cancelled", `Cancelled: ${why}`);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.cancelled", userIds: [job.requesterId, ...assignees(job)], exceptUserId: ctx.userId,
      title: `${job.reference} was cancelled`, body: why, eventKey: `cancelled:${job.id}`,
    });
  });
}

// ---------- Completion, closure, reopening ----------

const completionSchema = z.object({
  workPerformed: z.string().trim().min(5, "Describe the work performed.").max(5000),
  observations: z.string().trim().max(5000).default(""),
  completedAt: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
});

/**
 * IN_PROGRESS → AWAITING_VERIFICATION. Requires evidence (an "after" photo or a test document) and
 * no variation quote still awaiting the customer. Evidence is bound to this completion version.
 */
export async function submitCompletion(ctx: Ctx, jobId: string, input: z.input<typeof completionSchema>) {
  requirePerm(ctx, "job.work");
  const d = parse(completionSchema, input);
  const completedAt = d.completedAt ?? new Date();
  if (completedAt.getTime() > Date.now() + 60_000) throw invalid("Completion time cannot be in the future.");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    requireOnJob(ctx, job);
    // In-house: the technician submits from IN_PROGRESS. Contractor jobs: a manager may record the contractor's
    // completion on their behalf (e.g. photos sent by email) from ASSIGNED or IN_PROGRESS.
    const contractorJob = job.route === "CONTRACTOR";
    if (contractorJob && !isManager(ctx)) throw forbidden("The contractor submits completion for this job.");
    if (!(job.status === "IN_PROGRESS" || (contractorJob && job.status === "ASSIGNED"))) throw conflict("Only work that is in progress can be submitted as complete.");
    const evidence = await tx.attachment.findMany({
      where: { orgId: ctx.orgId, jobId: job.id, completionId: null, kind: { in: ["BEFORE", "AFTER", "TEST_DOCUMENT"] } }, select: { id: true, kind: true },
    });
    if (!evidence.some((e) => e.kind !== "BEFORE")) throw invalid("Add at least one after-photo or test document as completion evidence.");
    await move(tx, ctx.orgId, job, "AWAITING_VERIFICATION", { completedAt });
    const version = (await tx.completion.count({ where: { jobId: job.id } })) + 1;
    const c = await tx.completion.create({
      data: { orgId: ctx.orgId, jobId: job.id, version, workPerformed: d.workPerformed, observations: d.observations, completedAt, submittedById: ctx.userId,
        contractorId: contractorJob ? job.contractorId : null },
    });
    if (contractorJob) await revokeJobLinks(tx, ctx.orgId, job.id, "COMPLETION");
    await tx.attachment.updateMany({ where: { id: { in: evidence.map((e) => e.id) } }, data: { completionId: c.id } });
    await logEvent(tx, actorOf(ctx), job.id, "job.completion_submitted", `Completion submitted for verification (v${version})`, { completionId: c.id, evidence: evidence.length });
    await notifyCompletion(tx, ctx.orgId, job, c.id, ctx.userId);
    return c;
  });
}

/** Tell managers that work is done and, when required, ask the reporter to confirm it is fixed. */
export async function notifyCompletion(tx: Tx, orgId: string, job: { id: string; reference: string; title: string; requesterId: string | null; reporterConfirmation: boolean }, completionId: string, exceptUserId: string | null) {
  await notify(tx, {
    orgId, jobId: job.id, type: "job.completion_submitted", exceptUserId, userIds: await managerIds(tx, orgId),
    title: `${job.reference}: work completed – please check`, body: job.title, eventKey: `completion:${completionId}`,
  });
  if (job.reporterConfirmation && job.requesterId)
    await notify(tx, {
      orgId, jobId: job.id, type: "job.confirm_fixed", exceptUserId, userIds: [job.requesterId],
      title: `Is it fixed? ${job.reference}`, body: `The work on "${job.title}" is done. Please confirm the fault is fixed, or say what is still wrong.`, eventKey: `confirm:${completionId}`,
    });
}

const verifySchema = z.object({ outcome: z.enum(["APPROVED", "REJECTED"]), comment: z.string().trim().max(2000).default("") })
  .refine((d) => d.outcome === "APPROVED" || d.comment.length >= 3, { message: "Say what is still wrong so it can be put right." });

/**
 * Record whether the latest completion fixed the fault.
 *  - The REPORTER (the person who logged it) confirms in the app (via PORTAL).
 *  - A MANAGER can check it instead (via INTERNAL); when the reporter was supposed to confirm, a reason is required.
 * Rejected work goes back to IN_PROGRESS; for contractor jobs a fresh completion link is emailed.
 */
export async function confirmFixed(ctx: Ctx, jobId: string, input: z.input<typeof verifySchema>, opts: { signature?: { name: string; dataUrl: string } } = {}) {
  const d = parse(verifySchema, input);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    const reporter = !!job.requesterId && job.requesterId === ctx.userId;
    const manager = can(ctx, "job.manage");
    const captured = !!opts.signature; // reporter signs on a staff device
    if (captured) { requirePerm(ctx, "job.work"); if (!manager && !isAssigned(job, ctx.userId)) throw forbidden("You are not assigned to this job."); }
    else if (!reporter && !manager) throw forbidden("Only the person who reported this fault, or a maintenance manager, can confirm it.");
    else if (!reporter) requirePerm(ctx, "job.manage");
    if (!reporter && !captured && job.reporterConfirmation && d.outcome === "APPROVED" && d.comment.length < 3)
      throw invalid("The reporter normally confirms this. Say why you are confirming it instead (e.g. checked on site, reporter unavailable).");
    if (job.status !== "AWAITING_VERIFICATION") throw conflict("This job is not waiting for confirmation.");
    const c = await tx.completion.findFirst({ where: { jobId: job.id, status: "SUBMITTED" }, orderBy: { version: "desc" } });
    if (!c) throw conflict("There is no completed work waiting for confirmation.");
    const r = await tx.completion.updateMany({ where: { id: c.id, status: "SUBMITTED" }, data: { status: d.outcome } });
    if (r.count !== 1) throw conflict("A decision has already been recorded for this work.");
    let signatureId: string | null = null;
    if (opts.signature) {
      const { storeSignature } = await import("./attachments");
      signatureId = (await storeSignature(tx, { orgId: ctx.orgId, jobId: job.id, completionId: c.id, dataUrl: opts.signature.dataUrl })).id;
    }
    const via = captured ? "IN_PERSON" : reporter ? "PORTAL" : "INTERNAL";
    const deciderName = captured ? opts.signature!.name : ctx.userName;
    await tx.decision.create({
      data: { orgId: ctx.orgId, jobId: job.id, completionId: c.id, outcome: d.outcome, via, deciderUserId: captured ? null : ctx.userId,
        deciderName, deciderEmail: captured ? "" : ctx.userEmail, recordedById: reporter ? null : ctx.userId, comment: d.comment, signatureAttachmentId: signatureId },
    });
    const ok = d.outcome === "APPROVED";
    await move(tx, ctx.orgId, job, ok ? "VERIFIED" : "IN_PROGRESS", ok ? {} : { completedAt: null });
    const who = { PORTAL: "the reporter", INTERNAL: "the maintenance manager", IN_PERSON: "the reporter (signed on site)" }[via];
    await logEvent(tx, actorOf(ctx), job.id, ok ? "completion.approved" : "completion.rejected",
      `${ok ? "Confirmed fixed" : "Not fixed"} by ${deciderName} (${who})${d.comment ? `: ${d.comment}` : ""}`, { completionId: c.id, via });
    if (!ok && job.route === "CONTRACTOR" && job.contractorId) await issueCompletionLink(tx, ctx, job, `Rework needed: ${d.comment}`);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: ok ? "completion.approved" : "completion.rejected", exceptUserId: ctx.userId,
      userIds: [...(await managerIds(tx, ctx.orgId)), job.leadTechnicianId, c.submittedById],
      title: `${job.reference}: ${ok ? "confirmed fixed" : "NOT fixed – back to work"}`, body: d.comment || job.title, eventKey: `completion-decided:${c.id}`,
    });
  });
}

/**
 * Close a job: from VERIFIED (someone confirmed it is fixed), or straight from AWAITING_VERIFICATION when
 * reporter confirmation is not required (the manager's check is recorded as an INTERNAL decision).
 */
export async function closeJob(ctx: Ctx, jobId: string, input: { comment?: string } = {}) {
  requirePerm(ctx, "job.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    const completion = await tx.completion.findFirst({ where: { jobId: job.id }, orderBy: { version: "desc" }, include: { decision: true } });
    if (!completion) throw conflict("Work has not been submitted as complete yet.");
    if (job.status === "AWAITING_VERIFICATION") {
      if (job.reporterConfirmation) throw conflict("The person who reported this needs to confirm it is fixed first (or confirm it yourself with a reason).");
      const r = await tx.completion.updateMany({ where: { id: completion.id, status: "SUBMITTED" }, data: { status: "APPROVED" } });
      if (r.count !== 1) throw conflict("This completion has already been decided.");
      await tx.decision.create({
        data: { orgId: ctx.orgId, jobId: job.id, completionId: completion.id, outcome: "APPROVED", via: "INTERNAL", deciderUserId: ctx.userId,
          deciderName: ctx.userName, deciderEmail: ctx.userEmail, recordedById: ctx.userId, comment: (input.comment ?? "").slice(0, 1000) },
      });
      await logEvent(tx, actorOf(ctx), job.id, "job.verified", "Checked and confirmed fixed by the maintenance manager");
    } else if (job.status === "VERIFIED") {
      const d = completion.decision;
      if (completion.status !== "APPROVED" || !d || d.outcome !== "APPROVED") throw conflict("A confirmation for the latest completed work is missing.");
    }
    await move(tx, ctx.orgId, job, "CLOSED", { closedAt: new Date() });
    await revokeJobLinks(tx, ctx.orgId, job.id);
    await logEvent(tx, actorOf(ctx), job.id, "job.closed", "Job closed");
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.closed", userIds: [job.requesterId, ...assignees(job)], exceptUserId: ctx.userId,
      title: `${job.reference} has been closed`, body: job.title, eventKey: `closed:${job.id}:${job.reopenCount}`,
    });
  });
}

/** Send the appointed contractor a fresh completion link (e.g. they lost the email). */
export async function resendCompletionLink(ctx: Ctx, jobId: string) {
  requirePerm(ctx, "job.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (job.route !== "CONTRACTOR" || !job.contractorId || !["ASSIGNED", "IN_PROGRESS"].includes(job.status)) throw conflict("This job is not waiting for a contractor.");
    const r = await issueCompletionLink(tx, ctx, job, "Here is a new link to submit your completed work.");
    return r!.url;
  });
}

export async function reopenJob(ctx: Ctx, jobId: string, input: { reason: string }) {
  requirePerm(ctx, "job.manage");
  const why = parse(reason, input.reason);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    await move(tx, ctx.orgId, job, "ASSIGNED", { closedAt: null, completedAt: null, reopenCount: { increment: 1 }, overdueNotifiedAt: null });
    await logEvent(tx, actorOf(ctx), job.id, "job.reopened", `Reopened: ${why}`);
    if (job.route === "CONTRACTOR" && job.contractorId) await issueCompletionLink(tx, ctx, job, `The job was reopened: ${why}`);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.reopened", exceptUserId: ctx.userId,
      userIds: [...assignees(job), ...(await managerIds(tx, ctx.orgId))],
      title: `${job.reference} was reopened`, body: why, eventKey: `reopened:${job.id}:${job.reopenCount + 1}`,
    });
  });
}
