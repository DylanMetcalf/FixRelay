/** The organisation's own Sites → Locations → Assets, plus the public report token used by site links and QR codes. */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { conflict, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { can, jobScope, requirePerm, siteFilter, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";
import { assertWithinPlan } from "./billing";

const name = z.string().trim().min(1, "Name is required.").max(160);
const text = (max: number) => z.string().trim().max(max).default("");
const parse = <T extends z.ZodTypeAny>(s: T, v: unknown): z.output<T> => {
  const p = s.safeParse(v);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  return p.data;
};
/** 128-bit URL-safe token for the site's public report link. Not a secret, but not guessable either. */
export const newSiteToken = () => randomBytes(16).toString("base64url");

const inScope = (ctx: Ctx, siteId: string) => !ctx.siteIds.length || ctx.siteIds.includes(siteId);
export async function findSite(ctx: Ctx, siteId: string) {
  if (!z.string().uuid().safeParse(siteId).success || !inScope(ctx, siteId)) return null;
  return prisma.site.findFirst({ where: { id: siteId, orgId: ctx.orgId } });
}

const siteSchema = z.object({ name, address: text(500) });

export async function createSite(ctx: Ctx, input: z.input<typeof siteSchema>) {
  requirePerm(ctx, "sites.manage");
  const d = parse(siteSchema, input);
  return prisma.$transaction(async (tx) => {
    await assertWithinPlan(tx, ctx.orgId, "sites");
    const s = await tx.site.create({ data: { ...d, orgId: ctx.orgId, publicToken: newSiteToken() } });
    await logEvent(tx, actorOf(ctx), null, "site.created", `Site "${s.name}" added`);
    return s;
  });
}

export async function updateSite(ctx: Ctx, id: string, input: z.input<typeof siteSchema> & { archived?: boolean }) {
  requirePerm(ctx, "sites.manage");
  const d = parse(siteSchema, input);
  if (!(await findSite(ctx, id))) throw notFound("Site not found.");
  await prisma.site.update({ where: { id }, data: { ...d, archived: !!input.archived } });
}

/** Issue a new public link token: old QR codes and links for this site stop working. */
export async function rotateSiteToken(ctx: Ctx, id: string) {
  requirePerm(ctx, "sites.manage");
  if (!(await findSite(ctx, id))) throw notFound("Site not found.");
  return prisma.$transaction(async (tx) => {
    const s = await tx.site.update({ where: { id }, data: { publicToken: newSiteToken() } });
    await logEvent(tx, actorOf(ctx), null, "site.link_rotated", `Report link and QR codes for "${s.name}" were replaced`);
    return s;
  });
}

export async function listSites(ctx: Ctx, includeArchived = false) {
  requirePerm(ctx, "sites.view");
  return prisma.site.findMany({
    where: { orgId: ctx.orgId, ...(includeArchived ? {} : { archived: false }), ...(ctx.siteIds.length ? { id: { in: ctx.siteIds } } : {}) },
    include: { _count: { select: { locations: true, assets: true, jobs: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getSite(ctx: Ctx, id: string) {
  requirePerm(ctx, "sites.view");
  if (!(await findSite(ctx, id))) throw notFound("Site not found.");
  return prisma.site.findUniqueOrThrow({
    where: { id },
    include: {
      locations: { orderBy: { name: "asc" }, include: { _count: { select: { assets: true, jobs: true } } } },
      assets: { orderBy: { name: "asc" }, include: { location: { select: { name: true } } } },
    },
  });
}

/** Sites, locations and assets the person may report against (scoped to their sites). */
export async function requestFormOptions(ctx: Ctx) {
  requirePerm(ctx, "job.create");
  return prisma.site.findMany({
    where: { orgId: ctx.orgId, archived: false, ...(ctx.siteIds.length ? { id: { in: ctx.siteIds } } : {}) },
    select: {
      id: true, name: true,
      locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      assets: { select: { id: true, name: true, reference: true, locationId: true }, orderBy: { name: "asc" } },
    },
    orderBy: { name: "asc" },
  });
}

export async function createLocation(ctx: Ctx, input: { siteId: string; name: string; foodArea?: boolean }) {
  requirePerm(ctx, "sites.manage");
  const d = parse(z.object({ siteId: z.string().uuid(), name, foodArea: z.boolean().default(false) }), input);
  if (!(await findSite(ctx, d.siteId))) throw notFound("Site not found.");
  return prisma.location.create({ data: { ...d, orgId: ctx.orgId } });
}

/** Mark a location as a food-handling area (completion then asks the tools/clean-area question). */
export async function setFoodArea(ctx: Ctx, locationId: string, foodArea: boolean) {
  requirePerm(ctx, "sites.manage");
  const loc = await prisma.location.findFirst({ where: { id: locationId, orgId: ctx.orgId } });
  if (!loc || !(await findSite(ctx, loc.siteId))) throw notFound("Location not found.");
  return prisma.location.update({ where: { id: loc.id }, data: { foodArea } });
}

const assetSchema = z.object({
  siteId: z.string().uuid(), locationId: z.string().uuid().nullish(), reference: z.string().trim().min(1, "Reference is required.").max(60),
  name, type: text(80), manufacturer: text(80), model: text(80), serialNumber: text(80), notes: text(2000),
});

export async function createAsset(ctx: Ctx, input: z.input<typeof assetSchema>) {
  requirePerm(ctx, "sites.manage");
  const d = parse(assetSchema, input);
  if (!(await findSite(ctx, d.siteId))) throw notFound("Site not found.");
  if (d.locationId && !(await prisma.location.findFirst({ where: { id: d.locationId, orgId: ctx.orgId, siteId: d.siteId } })))
    throw invalid("That location is not at the selected site.");
  try {
    return await prisma.asset.create({ data: { ...d, locationId: d.locationId ?? null, orgId: ctx.orgId } });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`Asset reference "${d.reference}" is already in use.`);
    throw e;
  }
}

export async function listAssets(ctx: Ctx, q?: string) {
  requirePerm(ctx, "sites.view");
  return prisma.asset.findMany({
    where: {
      orgId: ctx.orgId, ...siteFilter(ctx),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { site: { select: { name: true } }, location: { select: { name: true } }, _count: { select: { jobs: true } } },
    orderBy: { name: "asc" }, take: 200,
  });
}

/** Asset with its maintenance history and total spend (jobs filtered by what the viewer may see). */
export async function getAsset(ctx: Ctx, id: string) {
  requirePerm(ctx, "sites.view");
  if (!z.string().uuid().safeParse(id).success) throw notFound("Asset not found.");
  const a = await prisma.asset.findFirst({ where: { id, orgId: ctx.orgId, ...siteFilter(ctx) }, include: { site: true, location: true } });
  if (!a) throw notFound("Asset not found.");
  const jobs = await prisma.job.findMany({
    where: { ...jobScope(ctx), assetId: id },
    select: { id: true, reference: true, title: true, status: true, route: true, reportedAt: true, closedAt: true, approvedCostCents: true },
    orderBy: { reportedAt: "desc" }, take: 100,
  });
  return { ...a, jobs, spendCents: jobs.reduce((t, j) => t + (j.approvedCostCents ?? 0), 0), canEdit: can(ctx, "sites.manage") };
}
