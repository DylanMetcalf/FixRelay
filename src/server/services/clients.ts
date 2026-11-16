/** Customers (client organisations of the tenant) → Sites → Locations → Assets. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conflict, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { can, jobScope, requirePerm, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";
import { assertWithinPlan } from "./billing";

const name = z.string().trim().min(1, "Name is required.").max(160);
const text = (max: number) => z.string().trim().max(max).default("");
const parse = <T extends z.ZodTypeAny>(s: T, v: unknown): z.output<T> => {
  const p = s.safeParse(v);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  return p.data;
};

const clientSchema = z.object({
  name, contactName: text(120), email: z.union([z.literal(""), z.string().trim().toLowerCase().email()]).default(""),
  phone: text(40), notes: text(2000),
});

export async function createClient(ctx: Ctx, input: z.input<typeof clientSchema>) {
  requirePerm(ctx, "clients.manage");
  const d = parse(clientSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertWithinPlan(tx, ctx.orgId, "clients");
    const c = await tx.client.create({ data: { ...d, orgId: ctx.orgId } });
    await logEvent(tx, actorOf(ctx), null, "client.created", `Customer "${c.name}" added`);
    return c;
  });
}

export async function updateClient(ctx: Ctx, id: string, input: z.input<typeof clientSchema> & { archived?: boolean }) {
  requirePerm(ctx, "clients.manage");
  const d = parse(clientSchema, input);
  const r = await prisma.client.updateMany({ where: { id, orgId: ctx.orgId }, data: { ...d, archived: !!input.archived } });
  if (r.count !== 1) throw notFound("Customer not found.");
}

export function listClients(ctx: Ctx) {
  requirePerm(ctx, "clients.view");
  return prisma.client.findMany({
    where: { orgId: ctx.orgId, archived: false },
    include: { _count: { select: { sites: true, jobs: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getClient(ctx: Ctx, id: string) {
  requirePerm(ctx, "clients.view");
  const c = await prisma.client.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      sites: { include: { locations: { orderBy: { name: "asc" } }, _count: { select: { assets: true } } }, orderBy: { name: "asc" } },
      memberships: { include: { user: { select: { name: true, email: true } } } },
    },
  });
  if (!c) throw notFound("Customer not found.");
  return c;
}

/**
 * Customer/site/location/asset choices for the "new request" form.
 * Anyone who may log a request needs these, so this is scoped rather than permission-gated:
 * a customer-side user only ever receives their own organisation.
 */
export function requestFormOptions(ctx: Ctx) {
  requirePerm(ctx, "job.create");
  return prisma.client.findMany({
    where: { orgId: ctx.orgId, archived: false, ...(ctx.clientId ? { id: ctx.clientId } : {}) },
    select: {
      id: true, name: true,
      sites: {
        select: {
          id: true, name: true,
          locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
          assets: { select: { id: true, name: true, reference: true, locationId: true }, orderBy: { name: "asc" } },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function createSite(ctx: Ctx, input: { clientId: string; name: string; address?: string }) {
  requirePerm(ctx, "clients.manage");
  const d = parse(z.object({ clientId: z.string().uuid(), name, address: text(500) }), input);
  if (!(await prisma.client.findFirst({ where: { id: d.clientId, orgId: ctx.orgId } }))) throw notFound("Customer not found.");
  return prisma.site.create({ data: { ...d, orgId: ctx.orgId } });
}

export async function createLocation(ctx: Ctx, input: { siteId: string; name: string }) {
  requirePerm(ctx, "clients.manage");
  const d = parse(z.object({ siteId: z.string().uuid(), name }), input);
  if (!(await prisma.site.findFirst({ where: { id: d.siteId, orgId: ctx.orgId } }))) throw notFound("Site not found.");
  return prisma.location.create({ data: { ...d, orgId: ctx.orgId } });
}

const assetSchema = z.object({
  siteId: z.string().uuid(), locationId: z.string().uuid().nullish(), reference: z.string().trim().min(1, "Reference is required.").max(60),
  name, type: text(80), manufacturer: text(80), model: text(80), serialNumber: text(80), notes: text(2000),
});

export async function createAsset(ctx: Ctx, input: z.input<typeof assetSchema>) {
  requirePerm(ctx, "clients.manage");
  const d = parse(assetSchema, input);
  if (!(await prisma.site.findFirst({ where: { id: d.siteId, orgId: ctx.orgId } }))) throw notFound("Site not found.");
  if (d.locationId && !(await prisma.location.findFirst({ where: { id: d.locationId, orgId: ctx.orgId, siteId: d.siteId } })))
    throw invalid("That location is not at the selected site.");
  try {
    return await prisma.asset.create({ data: { ...d, locationId: d.locationId ?? null, orgId: ctx.orgId } });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`Asset reference "${d.reference}" is already in use.`);
    throw e;
  }
}

export function listAssets(ctx: Ctx, q?: string) {
  requirePerm(ctx, "clients.view");
  return prisma.asset.findMany({
    where: {
      orgId: ctx.orgId,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { site: { select: { name: true, client: { select: { name: true } } } }, location: { select: { name: true } }, _count: { select: { jobs: true } } },
    orderBy: { name: "asc" }, take: 200,
  });
}

/** Asset with its maintenance history (jobs filtered by what the viewer may see). */
export async function getAsset(ctx: Ctx, id: string) {
  requirePerm(ctx, "clients.view");
  const a = await prisma.asset.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { site: { include: { client: { select: { id: true, name: true } } } }, location: true },
  });
  if (!a) throw notFound("Asset not found.");
  const jobs = await prisma.job.findMany({
    where: { ...jobScope(ctx), assetId: id },
    select: { id: true, reference: true, title: true, status: true, reportedAt: true, closedAt: true },
    orderBy: { reportedAt: "desc" }, take: 100,
  });
  return { ...a, jobs, canEdit: can(ctx, "clients.manage") };
}
