import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/server/permissions";
import * as clients from "@/server/services/clients";
import * as jobs from "@/server/services/jobs";
import { registerCompany } from "@/server/services/orgs";
import * as quotes from "@/server/services/quotes";
import { addJobAttachment } from "@/server/services/attachments";

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
export const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
export const uniq = () => randomUUID().slice(0, 8);

export async function member(orgId: string, roles: Role[], clientId: string | null = null, label = roles[0]!.toLowerCase()): Promise<Ctx> {
  const user = await prisma.user.create({ data: { email: `${label}-${uniq()}@example.com`, name: `${label} ${uniq()}`, passwordHash: "x" } });
  await prisma.membership.create({ data: { orgId, userId: user.id, roles, clientId } });
  return { userId: user.id, userName: user.name, userEmail: user.email, orgId, roles, clientId, support: false, locked: false };
}

/** A complete tenant: owner, manager, technician, one customer with a site and a client representative. */
export async function tenant() {
  const email = `owner-${uniq()}@example.com`;
  const reg = await registerCompany({ name: "Olive Owner", companyName: `Acme Maintenance ${uniq()}`, email, password: "correct-horse-battery" });
  const owner: Ctx = { userId: reg.userId, userName: "Olive Owner", userEmail: email, orgId: reg.orgId, roles: ["OWNER"], clientId: null, support: false, locked: false };
  const manager = await member(reg.orgId, ["MANAGER"]);
  const tech = await member(reg.orgId, ["TECHNICIAN"]);
  const client = await clients.createClient(owner, { name: `Client ${uniq()}`, email: "ops@client.example" });
  const site = await clients.createSite(owner, { clientId: client.id, name: "Main Plant", address: "1 Factory Rd" });
  const rep = await member(reg.orgId, ["CLIENT"], client.id, "rep");
  return { orgId: reg.orgId, token: reg.token, owner, manager, tech, client, site, rep };
}
export type Tenant = Awaited<ReturnType<typeof tenant>>;

export const newJob = (t: Tenant, by: Ctx = t.manager, extra: Partial<Parameters<typeof jobs.createJob>[1]> = {}) =>
  jobs.createJob(by, { title: "Conveyor belt slipping", description: "Belt slips under load on line 2.", clientId: t.client.id, siteId: t.site.id, ...extra });

export const LINES: quotes.QuoteLineInput[] = [
  { kind: "LABOUR", description: "Technician labour", quantity: "2.5", unitPriceCents: 65000, taxable: true },
  { kind: "MATERIAL", description: "Drive belt", quantity: "1", unitPriceCents: 123456, taxable: true },
];

/** Drives a job to AWAITING_APPROVAL with a submitted quote. */
export async function quotedJob(t: Tenant) {
  const job = await newJob(t);
  await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
  await jobs.submitAssessment(t.tech, job.id, { findings: "Worn drive belt", quoteRequired: true, labourHoursEstimate: "2.5" });
  const quote = await quotes.createQuote(t.manager, job.id);
  await quotes.saveQuote(t.manager, quote.id, { scope: "Replace drive belt", terms: "30 days", validUntil: null, lines: LINES });
  await quotes.submitQuote(t.manager, quote.id);
  return { job, quote };
}

/** Drives a job to IN_PROGRESS (authorised without a quote, assigned, started). */
export async function startedJob(t: Tenant, signoff = true) {
  const job = await newJob(t);
  await jobs.submitAssessment(t.manager, job.id, { findings: "Minor fault", quoteRequired: false });
  await jobs.authoriseWithoutQuote(t.manager, job.id, { reason: "Covered by service contract" });
  if (!signoff) await jobs.setSignoffRequired(t.manager, job.id, false);
  await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId });
  await jobs.startWork(t.tech, job.id);
  return job;
}

export async function completedJob(t: Tenant, signoff = true) {
  const job = await startedJob(t, signoff);
  await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after.png", bytes: PNG });
  const completion = await jobs.submitCompletion(t.tech, job.id, { workPerformed: "Replaced the belt and tested under load." });
  return { job, completion };
}

export const status = async (jobId: string) => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;
export const code = (c: string) => expect.objectContaining({ code: c });
import { expect } from "vitest";
