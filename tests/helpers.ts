import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { expect } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/permissions";
import { addJobAttachment } from "@/server/services/attachments";
import * as approvals from "@/server/services/approvals";
import * as contractors from "@/server/services/contractors";
import * as jobs from "@/server/services/jobs";
import { registerCompany } from "@/server/services/orgs";
import * as quotes from "@/server/services/quotes";
import * as sites from "@/server/services/sites";

/** A real, decodable 1×1 PNG (uploads are decoded and re-encoded, so fake bytes are rejected). */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
export const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
export const uniq = () => randomUUID().slice(0, 8);
export const code = (c: string) => expect.objectContaining({ code: c });

export async function member(orgId: string, roles: Role[], siteIds: string[] = [], label = roles[0]!.toLowerCase()): Promise<Ctx> {
  const user = await prisma.user.create({ data: { email: `${label}-${uniq()}@example.com`, name: `${label} ${uniq()}`, passwordHash: "x", emailVerifiedAt: new Date() } });
  await prisma.membership.create({ data: { orgId, userId: user.id, roles, siteIds } });
  return { userId: user.id, userName: user.name, userEmail: user.email, orgId, roles, siteIds, support: false, locked: false, emailVerified: true };
}

/**
 * A complete organisation: owner, maintenance manager, approver, technician, requester (reports faults),
 * one site with a location and equipment, and three contractors (two VAT registered).
 * Approval rules: manager ≤ R5 000, approver ≤ R50 000, 3 quotes above R10 000 (defaults).
 */
export async function tenant() {
  const email = `owner-${uniq()}@example.com`;
  const reg = await registerCompany({ name: "Olive Owner", companyName: `Acme Foods ${uniq()}`, email, password: "correct-horse-battery" });
  await prisma.user.update({ where: { id: reg.userId }, data: { emailVerifiedAt: new Date() } });
  const owner: Ctx = { userId: reg.userId, userName: "Olive Owner", userEmail: email, orgId: reg.orgId, roles: ["OWNER"], siteIds: [], support: false, locked: false, emailVerified: true };
  const [manager, approver, tech, requester] = [await member(reg.orgId, ["MANAGER"]), await member(reg.orgId, ["APPROVER"]), await member(reg.orgId, ["TECHNICIAN"]), await member(reg.orgId, ["REQUESTER"], [], "req")];
  const site = await sites.createSite(owner, { name: "Germiston Plant", address: "1 Factory Rd" });
  const location = await sites.createLocation(owner, { siteId: site.id, name: "Cold Room 2" });
  const asset = await sites.createAsset(owner, { siteId: site.id, locationId: location.id, reference: `CMP-${uniq()}`, name: "Compressor 2" });
  const c1 = await contractors.createContractor(owner, { name: "CoolTech", email: `cool-${uniq()}@contractor.test`, vatRegistered: true, vatNumber: "4111111111" });
  const c2 = await contractors.createContractor(owner, { name: "Sparks", email: `sparks-${uniq()}@contractor.test`, vatRegistered: true, vatNumber: "4222222222" });
  const c3 = await contractors.createContractor(owner, { name: "Handy Andy", email: `andy-${uniq()}@contractor.test` });
  return { orgId: reg.orgId, token: reg.token, owner, manager, approver, tech, requester, site, location, asset, contractors: [c1, c2, c3] as const };
}
export type Tenant = Awaited<ReturnType<typeof tenant>>;

export const newJob = (t: Tenant, by: Ctx = t.requester, extra: Partial<Parameters<typeof jobs.createJob>[1]> = {}) =>
  jobs.createJob(by, { title: "Compressor tripping", description: "Trips after 20 minutes.", siteId: t.site.id, locationId: t.location.id, assetId: t.asset.id, ...extra });

export async function assessedJob(t: Tenant, quoteRequired = true) {
  const job = await newJob(t);
  await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
  await jobs.submitAssessment(t.tech, job.id, { findings: "Capacitor degraded", recommendedWork: "Replace capacitor", quoteRequired });
  return job;
}

/** Contractor route: quotes requested from all three contractors; prices (excl. VAT, cents) captured for the first N. */
export async function quotingJob(t: Tenant, prices: number[] = [400000, 450000]) {
  const job = await assessedJob(t);
  const links = await quotes.requestQuotes(t.manager, job.id, { contractorIds: t.contractors.map((c) => c.id), scope: "Replace capacitor", deadline: null });
  const qs = [];
  for (let i = 0; i < prices.length; i++) qs.push(await quotes.recordQuote(t.manager, job.id, t.contractors[i]!.id, { scope: "Replace capacitor", priceExclVatCents: prices[i]! }));
  return { job, links, quotes: qs };
}

/** Contractor appointed: cheapest quote approved by the manager (within R5 000 limit). */
export async function appointedJob(t: Tenant) {
  const { job, quotes: qs } = await quotingJob(t, [300000, 350000]);
  await approvals.approveQuote(t.manager, qs[0]!.id, { poNumber: "PO-1" });
  return { job, quote: qs[0]!, contractor: t.contractors[0] };
}

/** In-house route, assigned and started by the technician. */
export async function inHouseJob(t: Tenant) {
  const job = await assessedJob(t, false);
  await jobs.routeInHouse(t.manager, job.id);
  await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
  await jobs.startWork(t.tech, job.id);
  return job;
}

export async function completedInHouse(t: Tenant, reporterConfirmation = true) {
  const job = await assessedJob(t, false);
  await jobs.routeInHouse(t.manager, job.id);
  if (!reporterConfirmation) await jobs.setSignoffRequired(t.manager, job.id, false);
  await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
  await jobs.startWork(t.tech, job.id);
  await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after.png", bytes: PNG });
  const completion = await jobs.submitCompletion(t.tech, job.id, { rootCauses: ["WEAR_AND_TEAR"], workPerformed: "Replaced the capacitor and tested." });
  return { job, completion };
}

export const status = async (jobId: string) => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;
/** Latest contractor link token for a job, read from the queued email (tokens are only ever stored hashed). */
export async function linkFromEmail(to: string) {
  const mail = await prisma.outboxEmail.findFirstOrThrow({ where: { toEmail: to }, orderBy: { createdAt: "desc" } });
  return /\/c\/([A-Za-z0-9_-]{43})/.exec(mail.body)![1]!;
}
