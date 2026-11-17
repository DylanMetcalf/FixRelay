/**
 * Demo workspace: a SEPARATE organisation flagged isDemo, owned by the requesting user, built by driving the real
 * services so it is always valid. Two sites, contractors, and jobs at every interesting stage. Contractor emails
 * use reserved domains, so nothing is ever delivered.
 */
import { prisma } from "@/lib/db";
import { conflict } from "@/lib/errors";
import type { Ctx } from "../permissions";
import * as approvals from "./approvals";
import * as contractors from "./contractors";
import * as jobs from "./jobs";
import { createOrganisation } from "./orgs";
import * as quotes from "./quotes";
import * as sites from "./sites";

export async function createDemoWorkspace(user: { id: string; name: string; email: string }): Promise<string> {
  if (await prisma.membership.findFirst({ where: { userId: user.id, org: { isDemo: true } } })) throw conflict("You already have a demo workspace.");
  const org = await prisma.$transaction((tx) => createOrganisation(tx, user.id, "Demo Foods – sample data", true));
  await prisma.membership.updateMany({ where: { orgId: org.id, userId: user.id }, data: { roles: ["OWNER", "MANAGER", "TECHNICIAN"] } });
  await prisma.organisation.update({ where: { id: org.id }, data: { publicReportingEnabled: true } });
  const ctx: Ctx = { userId: user.id, userName: user.name, userEmail: user.email, orgId: org.id, roles: ["OWNER", "MANAGER", "TECHNICIAN"], siteIds: [], support: false, locked: false, emailVerified: true };

  const plant = await sites.createSite(ctx, { name: "Germiston Plant", address: "14 Refinery Rd, Germiston" });
  const dc = await sites.createSite(ctx, { name: "Midrand Distribution Centre", address: "8 Lever Rd, Midrand" });
  const cold = await sites.createLocation(ctx, { siteId: plant.id, name: "Cold Room 2" });
  const packing = await sites.createLocation(ctx, { siteId: plant.id, name: "Packing Hall" });
  await sites.createLocation(ctx, { siteId: plant.id, name: "Staff Kitchen" });
  const bay = await sites.createLocation(ctx, { siteId: dc.id, name: "Loading Bay 3" });
  const comp = await sites.createAsset(ctx, { siteId: plant.id, locationId: cold.id, reference: "CMP-002", name: "Compressor 2", type: "Refrigeration compressor", manufacturer: "Bitzer", model: "4NES-20Y", serialNumber: "SN-48213" });
  const fork = await sites.createAsset(ctx, { siteId: dc.id, locationId: bay.id, reference: "FL-03", name: "Forklift 3", type: "Electric forklift", manufacturer: "Toyota", model: "8FBE18" });

  const cool = await contractors.createContractor(ctx, { name: "CoolTech Refrigeration", trade: "Refrigeration", contactName: "Sipho Dlamini", email: "quotes@cooltech.example", phone: "011 555 0101", vatRegistered: true, vatNumber: "4111111111" });
  const sparks = await contractors.createContractor(ctx, { name: "Sparks Electrical", trade: "Electrical", contactName: "Anne Botha", email: "office@sparks.example", phone: "011 555 0202", vatRegistered: true, vatNumber: "4222222222" });
  const lift = await contractors.createContractor(ctx, { name: "LiftRight Forklift Services", trade: "Materials handling", contactName: "Johan Pretorius", email: "service@liftright.example", phone: "011 555 0303" });

  // 1. A public report waiting to be screened.
  await jobs.createPublicReport(plant.publicToken, { title: "Tap leaking in staff kitchen", description: "Hot water tap won't close fully, dripping all day.", reporterName: "Grace (cleaning team)", reporterPhone: "072 555 0101", reporterEmail: "" });

  // 2. Getting quotes: two contractors have quoted.
  const j2 = await jobs.createJob(ctx, { title: "Compressor 2 tripping on overload", description: "Trips after about 20 minutes of running. Cold room temperature rising.", siteId: plant.id, locationId: cold.id, assetId: comp.id, category: "Electrical", priority: "CRITICAL" });
  await jobs.submitAssessment(ctx, j2.id, { findings: "Start capacitor degraded; contactor pitted.", recommendedWork: "Replace capacitor and contactor, test run 1 hour.", quoteRequired: true, externalHelpRequired: true });
  await quotes.requestQuotes(ctx, j2.id, { contractorIds: [cool.id, sparks.id], scope: "Replace start capacitor and contactor on Compressor 2 and test under load.", deadline: new Date(Date.now() + 3 * 86_400_000) });
  await quotes.recordQuote(ctx, j2.id, cool.id, { scope: "Replace capacitor + contactor, 1h test run.", priceExclVatCents: 685000, leadTimeDays: 1 });
  await quotes.recordQuote(ctx, j2.id, sparks.id, { scope: "Replace contactor and capacitor.", priceExclVatCents: 742000, leadTimeDays: 3 });

  // 3. In-house job in progress.
  const j3 = await jobs.createJob(ctx, { title: "Roller door at packing hall sticking", description: "Door jams half way when closing.", siteId: plant.id, locationId: packing.id, category: "Mechanical", priority: "HIGH" });
  await jobs.submitAssessment(ctx, j3.id, { findings: "Guide rail bent; needs straightening and lubrication.", quoteRequired: false });
  await jobs.routeInHouse(ctx, j3.id, {});
  await jobs.assignJob(ctx, j3.id, { leadTechnicianId: user.id, plannedEnd: new Date(Date.now() + 2 * 86_400_000).toISOString(), instructions: "Work before the 07:00 shift starts." });
  await jobs.startWork(ctx, j3.id);
  await jobs.addWorkUpdate(ctx, j3.id, { note: "Rail straightened, waiting for lubricant delivery.", labourMinutes: 60 });

  // 4. Contractor appointed (approved with a PO).
  const j4 = await jobs.createJob(ctx, { title: "Forklift 3 hydraulic leak", description: "Oil under the mast after use.", siteId: dc.id, locationId: bay.id, assetId: fork.id, category: "Mechanical", priority: "NORMAL" });
  await jobs.submitAssessment(ctx, j4.id, { findings: "Mast cylinder seal leaking.", quoteRequired: true });
  await quotes.requestQuotes(ctx, j4.id, { contractorIds: [lift.id], scope: "Replace mast cylinder seals and test.", deadline: null });
  const q4 = await quotes.recordQuote(ctx, j4.id, lift.id, { scope: "Reseal mast cylinders, top up hydraulic oil.", priceExclVatCents: 420000, leadTimeDays: 2 });
  await approvals.approveQuote(ctx, q4.id, { poNumber: "PO-1042", exceptionReason: "", comment: "Only approved forklift agent." });
  return org.id;
}
