/**
 * Departments (Maintenance, Operations, Finance …) and job handovers between them.
 * Kept separate on purpose: a department groups people; a role decides what they may do; the job status is the
 * stage of work; the job's department and owner say who is responsible right now.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { canHandOver, jobScope, requirePerm, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";
import { notify } from "./notifications";

const nameSchema = z.string().trim().min(2, "Give the department a name.").max(60);

export async function listDepartments(ctx: Ctx, opts: { withMembers?: boolean } = {}) {
  const depts = await prisma.department.findMany({
    where: { orgId: ctx.orgId, archived: false }, orderBy: { name: "asc" },
    include: opts.withMembers ? { members: { orderBy: { createdAt: "asc" } } } : undefined,
  });
  return depts as (typeof depts[number] & { members?: { userId: string; isManager: boolean }[] })[];
}

export async function createDepartment(ctx: Ctx, input: { name: string }) {
  requirePerm(ctx, "team.manage");
  const name = nameSchema.parse(input.name);
  try {
    return await prisma.$transaction(async (tx) => {
      const d = await tx.department.create({ data: { orgId: ctx.orgId, name } });
      await logEvent(tx, actorOf(ctx), null, "department.created", `Department "${name}" created`);
      return d;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A department with that name already exists.");
    throw e;
  }
}

export async function renameDepartment(ctx: Ctx, id: string, input: { name: string }) {
  requirePerm(ctx, "team.manage");
  const name = nameSchema.parse(input.name);
  const r = await prisma.department.updateMany({ where: { id, orgId: ctx.orgId }, data: { name } }).catch((e) => { if (isUniqueViolation(e)) throw conflict("A department with that name already exists."); throw e; });
  if (r.count !== 1) throw notFound("Department not found.");
}

/** Archive (never delete): jobs and handovers keep pointing at it for the record. */
export async function archiveDepartment(ctx: Ctx, id: string) {
  requirePerm(ctx, "team.manage");
  const open = await prisma.job.count({ where: { orgId: ctx.orgId, departmentId: id, status: { notIn: ["CLOSED", "CANCELLED"] } } });
  if (open) throw conflict(`Hand over its ${open} open job${open === 1 ? "" : "s"} to another department first.`);
  const r = await prisma.department.updateMany({ where: { id, orgId: ctx.orgId }, data: { archived: true } });
  if (r.count !== 1) throw notFound("Department not found.");
}

/** Add someone to a department (or change whether they manage it). They must be an active member of the company. */
export async function setDepartmentMember(ctx: Ctx, departmentId: string, input: { userId: string; isManager: boolean }) {
  requirePerm(ctx, "team.manage");
  const [dept, member] = await Promise.all([
    prisma.department.findFirst({ where: { id: departmentId, orgId: ctx.orgId, archived: false } }),
    prisma.membership.findFirst({ where: { orgId: ctx.orgId, userId: input.userId, active: true } }),
  ]);
  if (!dept) throw notFound("Department not found.");
  if (!member) throw invalid("Choose an active member of your team.");
  await prisma.departmentMember.upsert({
    where: { departmentId_userId: { departmentId, userId: input.userId } },
    create: { orgId: ctx.orgId, departmentId, userId: input.userId, isManager: input.isManager },
    update: { isManager: input.isManager },
  });
}

export async function removeDepartmentMember(ctx: Ctx, departmentId: string, userId: string) {
  requirePerm(ctx, "team.manage");
  await prisma.departmentMember.deleteMany({ where: { orgId: ctx.orgId, departmentId, userId } });
}

const handoverSchema = z.object({
  toDepartmentId: z.string().uuid().nullable().default(null),
  toUserId: z.string().uuid().nullable().default(null),
  reason: z.string().trim().min(3, "Say why, or what needs to happen next.").max(1000),
});

/**
 * Hand a job to another department and/or person. Records who passed it on, to whom, why, and when; updates the
 * responsible department and person; tells only the receiver (the person, or that department's managers).
 */
export async function handOverJob(ctx: Ctx, jobId: string, input: z.input<typeof handoverSchema>) {
  const d = handoverSchema.safeParse(input);
  if (!d.success) throw invalid(d.error.issues[0]!.message);
  const { toDepartmentId, toUserId, reason } = d.data;
  if (!toDepartmentId && !toUserId) throw invalid("Choose a department or a person to hand the job to.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, ...jobScope(ctx) } });
    if (!job) throw notFound("Job not found.");
    if (!canHandOver(ctx, job)) throw forbidden("Only maintenance managers or the responsible department's manager can hand this job over.");
    if (job.status === "CLOSED" || job.status === "CANCELLED") throw conflict("This job is finished. Reopen it first.");
    const dept = toDepartmentId ? await tx.department.findFirst({ where: { id: toDepartmentId, orgId: ctx.orgId, archived: false } }) : null;
    if (toDepartmentId && !dept) throw invalid("That department does not exist.");
    const person = toUserId ? await tx.membership.findFirst({ where: { orgId: ctx.orgId, userId: toUserId, active: true }, include: { user: { select: { name: true } } } }) : null;
    if (toUserId && !person) throw invalid("Choose an active member of your team.");
    if (person && person.siteIds.length && !person.siteIds.includes(job.siteId)) throw invalid(`${person.user.name} does not cover this site.`);
    const newDept = dept?.id ?? job.departmentId;
    if (newDept === job.departmentId && (toUserId ?? job.ownerId) === job.ownerId) throw conflict("The job is already with that department and person.");

    const r = await tx.job.updateMany({
      where: { id: job.id, orgId: ctx.orgId, updatedAt: job.updatedAt },
      data: { departmentId: newDept, ...(toUserId ? { ownerId: toUserId } : {}) },
    });
    if (r.count !== 1) throw conflict("Someone else just changed this job. Refresh and try again.");
    const h = await tx.jobHandover.create({ data: {
      orgId: ctx.orgId, jobId: job.id, fromDepartmentId: job.departmentId, toDepartmentId: newDept,
      fromUserId: job.ownerId, toUserId: toUserId ?? job.ownerId, byUserId: ctx.userId, reason,
    } });
    const to = [dept?.name, person?.user.name].filter(Boolean).join(" – ");
    await logEvent(tx, actorOf(ctx), job.id, "job.handover", `Handed over to ${to}: ${reason}`, { handoverId: h.id, toDepartmentId: newDept, toUserId });
    const receivers = toUserId ? [toUserId]
      : (await tx.departmentMember.findMany({ where: { departmentId: newDept!, isManager: true }, select: { userId: true } })).map((x) => x.userId);
    const fallback = receivers.length ? receivers : (await tx.departmentMember.findMany({ where: { departmentId: newDept! }, select: { userId: true } })).map((x) => x.userId);
    await notify(tx, {
      orgId: ctx.orgId, jobId: job.id, type: "job.handover", userIds: fallback, exceptUserId: ctx.userId,
      title: `${job.reference} handed over to ${to}`, body: `${job.title}\nNext: ${reason}`, eventKey: `handover:${h.id}`,
    });
    return h;
  });
}
