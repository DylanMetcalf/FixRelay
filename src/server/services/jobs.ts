/**
 * Maintenance requests / jobs: logging, triage, assessment, assignment, execution, completion, closure.
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
import { assertTransition, OPEN_STATUSES, REQUEST_STATUSES } from "../workflow";
import { actorOf, logEvent } from "./activity";
import { assertWithinPlan } from "./billing";
import { clientRepIds, managerIds, notify } from "./notifications";

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

export const isAssigned = (job: { leadTechnicianId: string | null; technicians: { userId: string }[] }, userId: string) =>
  job.leadTechnicianId === userId || job.technicians.some((t) => t.userId === userId);

/** Managers may act on any job; technicians only on jobs they are assigned to. */
function requireOnJob(ctx: Ctx, job: LoadedJob) {
  if (!isManager(ctx) && !isAssigned(job, ctx.userId)) throw forbidden("You are not assigned to this job.");
}

const assignees = (job: LoadedJob) => [job.leadTechnicianId, ...job.technicians.map((t) => t.userId)];

// ---------- Logging ----------

const createSchema = z.object({
  title: z.string().trim().min(3, "Give the request a short title.").max(160),
  description: z.string().trim().min(3, "Describe the problem.").max(5000),
  clientId: z.string().uuid("Choose a customer."),
  siteId: z.string().uuid("Choose a site."),
  locationId: optId, assetId: optId,
  category: z.enum(CATEGORIES).default("General"),
  priority: priority.default("NORMAL"),
  emergency: z.boolean().default(false),
});

export async function createJob(ctx: Ctx, input: z.input<typeof createSchema>) {
  requirePerm(ctx, "job.create");
  const d = parse(createSchema, input);
  if (ctx.clientId && d.clientId !== ctx.clientId) throw forbidden("You can only log requests for your own organisation.");
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({ where: { id: d.siteId, orgId: ctx.orgId, clientId: d.clientId, client: { archived: false } } });
    if (!site) throw invalid("That site does not belong to the selected customer.");
    if (d.locationId && !(await tx.location.findFirst({ where: { id: d.locationId, orgId: ctx.orgId, siteId: d.siteId } })))
      throw invalid("That location is not at the selected site.");
    if (d.assetId && !(await tx.asset.findFirst({ where: { id: d.assetId, orgId: ctx.orgId, siteId: d.siteId } })))
      throw invalid("That asset is not at the selected site.");
    await assertWithinPlan(tx, ctx.orgId, "activeJobs");
    // Incrementing the counter locks the organisation row, so references are gap-free and unique.
    const org = await tx.organisation.update({ where: { id: ctx.orgId }, data: { jobSeq: { increment: 1 } } });
    const rule = await tx.priorityRule.findUnique({ where: { orgId_priority: { orgId: ctx.orgId, priority: d.priority } } });
    const now = new Date();
    const job = await tx.job.create({
      data: {
        ...d, orgId: ctx.orgId, reference: `REQ-${String(org.jobSeq).padStart(5, "0")}`, requesterId: ctx.userId,
        reportedAt: now, customerSignoffRequired: org.customerSignoffRequired,
        dueAt: rule ? new Date(now.getTime() + rule.completionHours * 3_600_000) : null,
      },
    });
    await logEvent(tx, actorOf(ctx), job.id, "job.created", `Request logged: ${job.title}`, { priority: d.priority, emergency: d.emergency });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.created", userIds: await managerIds(tx, ctx.orgId), exceptUserId: ctx.userId,
      title: `${d.emergency ? "EMERGENCY: " : ""}New request ${job.reference}`, body: job.title, eventKey: `job-created:${job.id}`,
    });
    return job;
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
      client: { select: { id: true, name: true, contactName: true, email: true } },
      site: { select: { id: true, name: true, address: true } },
      location: { select: { name: true } },
      asset: { select: { id: true, name: true, reference: true } },
      technicians: true,
      assessments: { orderBy: { createdAt: "desc" } },
      quotes: { include: { lines: { orderBy: { position: "asc" } }, decision: true }, orderBy: [{ createdAt: "desc" }] },
      updates: { orderBy: { createdAt: "desc" } },
      completions: { include: { decision: true }, orderBy: { version: "desc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!job) throw notFound("Job not found.");
  if (!seePrices) job.quotes = [];
  if (!staff) {
    job.assessments = [];
    job.updates = [];
    job.instructions = null;
    job.quotes = job.quotes.filter((q) => q.status !== "DRAFT" && q.status !== "WITHDRAWN");
    job.attachments = job.attachments.filter((a) => (CUSTOMER_VISIBLE_KINDS as readonly string[]).includes(a.kind));
    job.events = job.events.filter((e) => !e.type.startsWith("work.") && !e.type.startsWith("assessment."));
  }
  const ids = new Set<string>([job.requesterId, ...job.events.map((e) => e.actorUserId ?? "")]);
  for (const x of [job.ownerId, job.leadTechnicianId, ...job.technicians.map((t) => t.userId), ...job.updates.map((u) => u.authorId),
    ...job.assessments.map((a) => a.authorId), ...job.completions.map((c) => c.submittedById)]) if (x) ids.add(x);
  ids.delete("");
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  return { ...job, people: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>, assigned: isAssigned(job, ctx.userId) };
}
export type JobView = Awaited<ReturnType<typeof getJob>>;

export interface JobFilters {
  view?: "requests" | "jobs" | "mine" | "all";
  status?: JobStatus; clientId?: string; siteId?: string; technicianId?: string;
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
  if (uuid(f.clientId)) and.push({ clientId: f.clientId });
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
      customerSignoffRequired: true, leadTechnicianId: true, plannedStart: true, closedAt: true,
      client: { select: { name: true } }, site: { select: { name: true } },
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
  const [byStatus, overdue, unowned, recentlyClosed] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], where, _count: true }),
    prisma.job.count({ where: { AND: [where, { status: { in: OPEN_STATUSES }, dueAt: { lt: now } }] } }),
    prisma.job.count({ where: { AND: [where, { status: "NEW", ownerId: null }] } }),
    prisma.job.count({ where: { AND: [where, { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }] } }),
  ]);
  const n = (s: JobStatus) => byStatus.find((x) => x.status === s)?._count ?? 0;
  return {
    newRequests: n("NEW"), unowned, awaitingAssessment: n("ASSESSING"), assessed: n("ASSESSED"), quoting: n("QUOTING"),
    awaitingApproval: n("AWAITING_APPROVAL"), awaitingAssignment: n("APPROVED"), assigned: n("ASSIGNED"),
    inProgress: n("IN_PROGRESS"), onHold: n("ON_HOLD"), awaitingVerification: n("AWAITING_VERIFICATION"),
    readyToClose: n("VERIFIED"), overdue, recentlyClosed,
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
      throw conflict("Sign-off requirements cannot change once work has been submitted.");
    const r = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data: { customerSignoffRequired: required } });
    if (r.count !== 1) throw conflict("This job was just changed by someone else. Refresh and try again.");
    await logEvent(tx, actorOf(ctx), job.id, "job.signoff_rule_changed", `Customer sign-off ${required ? "required" : "not required"} for this job`);
  });
}

async function assertStaffMembers(tx: Tx, orgId: string, userIds: string[]) {
  const ids = [...new Set(userIds)];
  const n = await tx.membership.count({
    where: { orgId, userId: { in: ids }, active: true, clientId: null, roles: { hasSome: ["TECHNICIAN", "MANAGER", "OWNER"] } },
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
 * Authorise work WITHOUT a customer-approved quotation (e.g. covered by contract, emergency call-out).
 * This is the explicit rule for skipping quotation: manager-only, mandatory reason, permanently audited.
 */
export async function authoriseWithoutQuote(ctx: Ctx, jobId: string, input: { reason: string }) {
  requirePerm(ctx, "job.manage");
  const why = parse(reason, input.reason);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    if (!["NEW", "ASSESSED", "QUOTING"].includes(job.status)) throw conflict("This job cannot be authorised without a quotation at this stage.");
    if (job.status === "NEW" && !job.emergency) throw conflict("Only emergency requests can be authorised before assessment.");
    await move(tx, ctx.orgId, job, "APPROVED", { directAuthReason: why, ownerId: job.ownerId ?? ctx.userId });
    await tx.quote.updateMany({ where: { jobId: job.id, orgId: ctx.orgId, status: "DRAFT" }, data: { status: "WITHDRAWN" } });
    await logEvent(tx, actorOf(ctx), job.id, "job.authorised_without_quote", `Work authorised without quotation: ${why}`);
  });
}

// ---------- Assignment ----------

const assignSchema = z.object({
  leadTechnicianId: z.string().uuid("Choose the responsible technician."),
  additionalIds: z.array(z.string().uuid()).max(20).default([]),
  externalContractor: z.string().trim().max(200).default(""),
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
    await assertStaffMembers(tx, ctx.orgId, [d.leadTechnicianId, ...extra]);
    const data = {
      leadTechnicianId: d.leadTechnicianId, externalContractor: d.externalContractor || null, plannedStart: d.plannedStart,
      plannedEnd: d.plannedEnd, instructions: d.instructions || null, ownerId: job.ownerId ?? ctx.userId,
      ...(d.plannedEnd ? { dueAt: d.plannedEnd, overdueNotifiedAt: null } : {}),
    };
    if (job.status === "APPROVED") await move(tx, ctx.orgId, job, "ASSIGNED", { ...data, assignedAt: job.assignedAt ?? new Date() });
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
    // Nothing may be approved against a cancelled job.
    const open = await tx.quote.findMany({ where: { jobId: job.id, status: { in: ["DRAFT", "SUBMITTED"] } }, select: { id: true } });
    await tx.quote.updateMany({ where: { id: { in: open.map((q) => q.id) } }, data: { status: "WITHDRAWN" } });
    await tx.approvalLink.updateMany({ where: { orgId: ctx.orgId, quoteId: { in: open.map((q) => q.id) }, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
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
    if (job.status !== "IN_PROGRESS") throw conflict("Only work that is in progress can be submitted as complete.");
    if (await tx.quote.count({ where: { jobId: job.id, kind: "VARIATION", status: { in: ["DRAFT", "SUBMITTED"] } } }))
      throw conflict("Additional work is still awaiting a quotation decision. Resolve it before submitting completion.");
    const evidence = await tx.attachment.findMany({
      where: { orgId: ctx.orgId, jobId: job.id, completionId: null, kind: { in: ["BEFORE", "AFTER", "TEST_DOCUMENT"] } }, select: { id: true, kind: true },
    });
    if (!evidence.some((e) => e.kind !== "BEFORE")) throw invalid("Add at least one after-photo or test document as completion evidence.");
    await move(tx, ctx.orgId, job, "AWAITING_VERIFICATION", { completedAt });
    const version = (await tx.completion.count({ where: { jobId: job.id } })) + 1;
    const c = await tx.completion.create({
      data: { orgId: ctx.orgId, jobId: job.id, version, workPerformed: d.workPerformed, observations: d.observations, completedAt, submittedById: ctx.userId },
    });
    await tx.attachment.updateMany({ where: { id: { in: evidence.map((e) => e.id) } }, data: { completionId: c.id } });
    await logEvent(tx, actorOf(ctx), job.id, "job.completion_submitted", `Completion submitted for verification (v${version})`, { completionId: c.id, evidence: evidence.length });
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.completion_submitted", exceptUserId: ctx.userId,
      userIds: [...(await managerIds(tx, ctx.orgId)), ...(job.customerSignoffRequired ? await clientRepIds(tx, ctx.orgId, job.clientId) : [])],
      title: `${job.reference}: work completed – verification required`, body: job.title, eventKey: `completion:${c.id}`,
    });
    return c;
  });
}

/**
 * Close a job. If customer sign-off is required, a customer approval (link, portal or captured in person)
 * of the LATEST completion must exist — a manager cannot close around it. Otherwise the manager's own
 * verification is recorded as an INTERNAL decision.
 */
export async function closeJob(ctx: Ctx, jobId: string, input: { comment?: string } = {}) {
  requirePerm(ctx, "job.manage");
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    const completion = await tx.completion.findFirst({ where: { jobId: job.id }, orderBy: { version: "desc" }, include: { decision: true } });
    if (!completion) throw conflict("Work has not been submitted as complete yet.");
    if (job.status === "AWAITING_VERIFICATION") {
      if (job.customerSignoffRequired) throw conflict("This job needs customer sign-off before it can be closed.");
      const r = await tx.completion.updateMany({ where: { id: completion.id, status: "SUBMITTED" }, data: { status: "APPROVED" } });
      if (r.count !== 1) throw conflict("This completion has already been decided.");
      await tx.decision.create({
        data: { orgId: ctx.orgId, jobId: job.id, completionId: completion.id, outcome: "APPROVED", via: "INTERNAL", deciderUserId: ctx.userId,
          deciderName: ctx.userName, deciderEmail: ctx.userEmail, recordedById: ctx.userId, comment: (input.comment ?? "").slice(0, 1000) },
      });
      await logEvent(tx, actorOf(ctx), job.id, "job.verified", "Work verified internally (customer sign-off not required)");
    } else if (job.status === "VERIFIED") {
      const d = completion.decision;
      if (completion.status !== "APPROVED" || !d || d.outcome !== "APPROVED" || (job.customerSignoffRequired && d.via === "INTERNAL"))
        throw conflict("A valid sign-off for the latest completion is missing.");
    }
    await move(tx, ctx.orgId, job, "CLOSED", { closedAt: new Date() });
    await logEvent(tx, actorOf(ctx), job.id, "job.closed", "Job closed");
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.closed", userIds: [job.requesterId, ...assignees(job)], exceptUserId: ctx.userId,
      title: `${job.reference} has been closed`, body: job.title, eventKey: `closed:${job.id}:${job.reopenCount}`,
    });
  });
}

export async function reopenJob(ctx: Ctx, jobId: string, input: { reason: string }) {
  requirePerm(ctx, "job.manage");
  const why = parse(reason, input.reason);
  return prisma.$transaction(async (tx) => {
    const job = await loadJob(tx, ctx, jobId);
    await move(tx, ctx.orgId, job, "ASSIGNED", { closedAt: null, completedAt: null, reopenCount: { increment: 1 }, overdueNotifiedAt: null });
    await logEvent(tx, actorOf(ctx), job.id, "job.reopened", `Reopened: ${why}`);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.reopened", exceptUserId: ctx.userId,
      userIds: [...assignees(job), ...(await managerIds(tx, ctx.orgId))],
      title: `${job.reference} was reopened`, body: why, eventKey: `reopened:${job.id}:${job.reopenCount + 1}`,
    });
  });
}
