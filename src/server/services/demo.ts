/**
 * Demo workspace: a SEPARATE organisation flagged isDemo, owned by the requesting user.
 * Sample data never enters a live company. Built by driving the real services, so it is always valid data.
 */
import { prisma } from "@/lib/db";
import { conflict } from "@/lib/errors";
import type { Ctx } from "../permissions";
import * as clients from "./clients";
import * as jobs from "./jobs";
import { createOrganisation } from "./orgs";
import * as quotes from "./quotes";

export async function createDemoWorkspace(user: { id: string; name: string; email: string }): Promise<string> {
  if (await prisma.membership.findFirst({ where: { userId: user.id, org: { isDemo: true } } })) throw conflict("You already have a demo workspace.");
  const org = await prisma.$transaction((tx) => createOrganisation(tx, user.id, "Demo Maintenance Co (sample data)", true));
  const ctx: Ctx = { userId: user.id, userName: user.name, userEmail: user.email, orgId: org.id, roles: ["OWNER", "TECHNICIAN"], clientId: null, support: false, locked: false };
  await prisma.membership.updateMany({ where: { orgId: org.id, userId: user.id }, data: { roles: ["OWNER", "TECHNICIAN"] } });
  await prisma.organisation.update({ where: { id: org.id }, data: { vatRegistered: true, vatNumber: "4000000000", quoteTerms: "Payment within 30 days. Prices valid as stated." } });

  const c1 = await clients.createClient(ctx, { name: "Karoo Cold Storage", contactName: "Thandi Mokoena", email: "thandi@karoocold.example", phone: "011 555 0101" });
  const c2 = await clients.createClient(ctx, { name: "Bayside Shopping Centre", contactName: "Pieter Naidoo", email: "pieter@bayside.example" });
  const s1 = await clients.createSite(ctx, { clientId: c1.id, name: "Germiston Depot", address: "14 Refinery Rd, Germiston" });
  const s2 = await clients.createSite(ctx, { clientId: c2.id, name: "Main Mall", address: "2 Beach Rd, Gqeberha" });
  const loc = await clients.createLocation(ctx, { siteId: s1.id, name: "Freezer Room 2" });
  const asset = await clients.createAsset(ctx, { siteId: s1.id, locationId: loc.id, reference: "CMP-002", name: "Compressor 2", type: "Refrigeration compressor", manufacturer: "Bitzer", model: "4NES-20Y", serialNumber: "SN-48213" });

  await jobs.createJob(ctx, { title: "Roller door stuck half open", description: "Loading bay 3 roller door will not close.", clientId: c1.id, siteId: s1.id, category: "Mechanical", priority: "HIGH" });

  const j2 = await jobs.createJob(ctx, { title: "Compressor 2 tripping on overload", description: "Trips after about 20 minutes of running.", clientId: c1.id, siteId: s1.id, locationId: loc.id, assetId: asset.id, category: "Electrical", priority: "CRITICAL" });
  await jobs.submitAssessment(ctx, j2.id, { findings: "Start capacitor degraded; contactor pitted.", suspectedCause: "Component age", recommendedWork: "Replace capacitor and contactor, test run 1 hour.", materials: "1 × capacitor, 1 × contactor", labourHoursEstimate: "3", quoteRequired: true });
  const q = await quotes.createQuote(ctx, j2.id);
  await quotes.saveQuote(ctx, q.id, {
    scope: "Replace start capacitor and contactor on Compressor 2. Test under load.", terms: "Payment within 30 days.", validUntil: null,
    lines: [
      { kind: "LABOUR", description: "Refrigeration technician", quantity: "3", unitPriceCents: 75000, taxable: true },
      { kind: "MATERIAL", description: "Start capacitor 50µF", quantity: "1", unitPriceCents: 48500, taxable: true },
      { kind: "MATERIAL", description: "Contactor 3-pole 32A", quantity: "1", unitPriceCents: 129900, taxable: true },
      { kind: "OTHER", description: "Call-out fee", quantity: "1", unitPriceCents: 65000, taxable: true },
    ],
  });
  await quotes.submitQuote(ctx, q.id);

  const j3 = await jobs.createJob(ctx, { title: "Escalator handrail squeaking", description: "Up escalator near food court.", clientId: c2.id, siteId: s2.id, category: "Mechanical", priority: "NORMAL" });
  await jobs.submitAssessment(ctx, j3.id, { findings: "Handrail drive needs lubrication and tension adjustment.", quoteRequired: false });
  await jobs.authoriseWithoutQuote(ctx, j3.id, { reason: "Covered by monthly service contract" });
  await jobs.assignJob(ctx, j3.id, { leadTechnicianId: user.id, plannedEnd: new Date(Date.now() + 2 * 86_400_000).toISOString(), instructions: "Work before 09:00 trading hours." });
  await jobs.startWork(ctx, j3.id);
  await jobs.addWorkUpdate(ctx, j3.id, { note: "Lubricated drive chain, adjusted tension. Monitoring.", labourMinutes: 45 });
  return org.id;
}
