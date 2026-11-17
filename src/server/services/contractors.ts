/** Directory of external contractors the site uses. Contractors are not users; they work through secure job links. */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { invalid, notFound } from "@/lib/errors";
import { requirePerm, type Ctx } from "../permissions";
import { actorOf, logEvent } from "./activity";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the contractor's company name.").max(160),
  trade: z.string().trim().max(120).default(""),
  contactName: z.string().trim().max(120).default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email address – quote requests are sent to it.").max(200),
  phone: z.string().trim().max(40).default(""),
  vatRegistered: z.boolean().default(false),
  vatNumber: z.string().trim().max(20).default(""),
  notes: z.string().trim().max(2000).default(""),
});
export type ContractorInput = z.input<typeof schema>;
const parse = (v: unknown) => {
  const p = schema.safeParse(v);
  if (!p.success) throw invalid(p.error.issues[0]!.message);
  if (p.data.vatRegistered && !p.data.vatNumber) throw invalid("Enter the contractor's VAT number, or untick VAT registered.");
  return p.data;
};

export async function createContractor(ctx: Ctx, input: ContractorInput) {
  requirePerm(ctx, "contractors.manage");
  const d = parse(input);
  return prisma.$transaction(async (tx) => {
    const c = await tx.contractor.create({ data: { ...d, orgId: ctx.orgId } });
    await logEvent(tx, actorOf(ctx), null, "contractor.created", `Contractor "${c.name}" added`);
    return c;
  });
}

export async function updateContractor(ctx: Ctx, id: string, input: ContractorInput & { active?: boolean }) {
  requirePerm(ctx, "contractors.manage");
  const d = parse(input);
  const r = await prisma.contractor.updateMany({ where: { id, orgId: ctx.orgId }, data: { ...d, active: input.active ?? true } });
  if (r.count !== 1) throw notFound("Contractor not found.");
}

export async function listContractors(ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  requirePerm(ctx, "contractors.view");
  return prisma.contractor.findMany({
    where: { orgId: ctx.orgId, ...(opts.activeOnly ? { active: true } : {}) },
    include: { _count: { select: { jobs: true, quotes: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Contractor with their jobs and quotes (for the profile page and performance figures). */
export async function getContractor(ctx: Ctx, id: string) {
  requirePerm(ctx, "contractors.view");
  if (!z.string().uuid().safeParse(id).success) throw notFound("Contractor not found.");
  const c = await prisma.contractor.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      jobs: { select: { id: true, reference: true, title: true, status: true, approvedCostCents: true, assignedAt: true, completedAt: true, reopenCount: true, site: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 },
      quotes: { select: { id: true, number: true, version: true, status: true, totalCents: true, submittedAt: true, jobId: true }, orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!c) throw notFound("Contractor not found.");
  return c;
}
