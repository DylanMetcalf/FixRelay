/**
 * Demo workspace: a SEPARATE organisation flagged isDemo, owned by the requesting user, built by driving the real
 * services so it is always valid. Synthetic data only: two sites, departments, sample people for every role
 * (who cannot sign in, but the demonstrator can "view as" them), contractors, and jobs at every stage.
 * No email is ever sent from a demo company, and sample addresses use reserved domains.
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
import sharp from "sharp";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { departmentsOf } from "../auth";
import * as departments from "./departments";
import { addJobAttachment } from "./attachments";

export const PERSONAS = [
  { key: "admin", name: "Thandi Nkosi", jobTitle: "Site administrator", roles: ["OWNER"], dept: "Management", manager: true },
  { key: "manager", name: "Sipho Maseko", jobTitle: "Maintenance manager", roles: ["MANAGER"], dept: "Maintenance", manager: true },
  { key: "tech", name: "Jabu Mokoena", jobTitle: "Maintenance technician", roles: ["TECHNICIAN"], dept: "Maintenance", manager: false },
  { key: "approver", name: "Lerato Botha", jobTitle: "Finance manager", roles: ["APPROVER"], dept: "Finance", manager: true },
  { key: "ops", name: "Pieter van Wyk", jobTitle: "Operations manager", roles: ["REQUESTER"], dept: "Operations", manager: true },
  { key: "reporter", name: "Grace Adams", jobTitle: "Packing line operator", roles: ["REQUESTER"], dept: "Operations", manager: false },
] as const;

export async function createDemoWorkspace(user: { id: string; name: string; email: string }): Promise<string> {
  if (await prisma.membership.findFirst({ where: { userId: user.id, active: true, org: { isDemo: true, archivedAt: null } } })) throw conflict("You already have a demo workspace.");
  const org = await prisma.$transaction((tx) => createOrganisation(tx, user.id, "Demo Foods – sample data", true));
  await prisma.membership.updateMany({ where: { orgId: org.id, userId: user.id }, data: { roles: ["OWNER", "MANAGER", "TECHNICIAN"] } });
  // Requisition numbers continue a paper book (12600, 12601, …).
  await prisma.organisation.update({ where: { id: org.id }, data: { publicReportingEnabled: true, referencePrefix: "", jobSeq: 12599 } });
  const ctx: Ctx = { userId: user.id, userName: user.name, userEmail: user.email, orgId: org.id, roles: ["OWNER", "MANAGER", "TECHNICIAN"], siteIds: [], support: false, locked: false, emailVerified: true };

  const plant = await sites.createSite(ctx, { name: "Germiston Plant", address: "14 Refinery Rd, Germiston" });
  const dc = await sites.createSite(ctx, { name: "Midrand Distribution Centre", address: "8 Lever Rd, Midrand" });
  const cold = await sites.createLocation(ctx, { siteId: plant.id, name: "Cold Room 2" });
  const packing = await sites.createLocation(ctx, { siteId: plant.id, name: "Packing Hall" });
  const kitchen = await sites.createLocation(ctx, { siteId: plant.id, name: "Staff Kitchen", foodArea: true });
  const bay = await sites.createLocation(ctx, { siteId: dc.id, name: "Loading Bay 3" });
  const comp = await sites.createAsset(ctx, { siteId: plant.id, locationId: cold.id, reference: "CMP-002", name: "Compressor 2", type: "Refrigeration compressor", manufacturer: "Bitzer", model: "4NES-20Y", serialNumber: "SN-48213" });
  const fork = await sites.createAsset(ctx, { siteId: dc.id, locationId: bay.id, reference: "FL-03", name: "Forklift 3", type: "Electric forklift", manufacturer: "Toyota", model: "8FBE18" });

  const cool = await contractors.createContractor(ctx, { name: "CoolTech Refrigeration", trade: "Refrigeration", contactName: "Sipho Dlamini", email: "quotes@cooltech.example", phone: "011 555 0101", vatRegistered: true, vatNumber: "4111111111" });
  const sparks = await contractors.createContractor(ctx, { name: "Sparks Electrical", trade: "Electrical", contactName: "Anne Botha", email: "office@sparks.example", phone: "011 555 0202", vatRegistered: true, vatNumber: "4222222222" });
  const lift = await contractors.createContractor(ctx, { name: "LiftRight Forklift Services", trade: "Materials handling", contactName: "Johan Pretorius", email: "service@liftright.example", phone: "011 555 0303" });

  // Departments and sample people. Persona accounts cannot sign in (unknown random password, blocked at login).
  const depts: Record<string, string> = {};
  for (const name of ["Maintenance", "Operations", "Finance", "Management"]) depts[name] = (await prisma.department.create({ data: { orgId: org.id, name } })).id;
  await prisma.departmentMember.create({ data: { orgId: org.id, departmentId: depts.Maintenance!, userId: user.id, isManager: true } });
  const people: Record<string, Ctx> = {};
  const unusable = await bcrypt.hash(randomBytes(32).toString("hex"), 4);
  for (const p of PERSONAS) {
    const u = await prisma.user.create({ data: { email: `${p.key}.${org.id.slice(0, 8)}@demo.resultra.invalid`, name: p.name, jobTitle: p.jobTitle, passwordHash: unusable, demoPersona: true, emailVerifiedAt: new Date() } });
    await prisma.membership.create({ data: { orgId: org.id, userId: u.id, roles: [...p.roles] } });
    await prisma.departmentMember.create({ data: { orgId: org.id, departmentId: depts[p.dept]!, userId: u.id, isManager: p.manager } });
    people[p.key] = { userId: u.id, userName: u.name, userEmail: u.email, orgId: org.id, roles: [...p.roles], siteIds: [], support: false, locked: false, emailVerified: true,
      ...(await departmentsOf(org.id, u.id)) };
  }
  const { manager: sipho, tech: jabu, approver: lerato, ops: pieter, reporter: grace } = people as Record<string, Ctx>;

  // 1. A public report waiting to be screened.
  await jobs.createPublicReport(plant.publicToken, { title: "Tap leaking in staff kitchen", description: "Hot water tap won't close fully, dripping all day.", reporterName: "Grace (cleaning team)", reporterPhone: "072 555 0101", reporterEmail: "" });

  // 2. Getting quotes: two contractors have quoted.
  const j2 = await jobs.createJob(ctx, { title: "Compressor 2 tripping on overload", description: "Trips after about 20 minutes of running. Cold room temperature rising.", siteId: plant.id, locationId: cold.id, assetId: comp.id, category: "Electrical", priority: "CRITICAL" });
  await addJobAttachment(ctx, { jobId: j2.id, kind: "REQUEST", filename: "compressor-panel.jpg", bytes: await samplePhoto(2) });
  await jobs.submitAssessment(ctx, j2.id, { findings: "Start capacitor degraded; contactor pitted.", recommendedWork: "Replace capacitor and contactor, test run 1 hour.", quoteRequired: true, externalHelpRequired: true });
  await quotes.requestQuotes(ctx, j2.id, { contractorIds: [cool.id, sparks.id], scope: "Replace start capacitor and contactor on Compressor 2 and test under load.", deadline: new Date(Date.now() + 3 * 86_400_000) });
  await quotes.recordQuote(ctx, j2.id, cool.id, { scope: "Replace capacitor + contactor, 1h test run.", priceExclVatCents: 685000, leadTimeDays: 1 });
  await quotes.recordQuote(ctx, j2.id, sparks.id, { scope: "Replace contactor and capacitor.", priceExclVatCents: 742000, leadTimeDays: 3 });

  // 3. In-house job in progress.
  const j3 = await jobs.createJob(ctx, { title: "Roller door at packing hall sticking", description: "Door jams half way when closing.", siteId: plant.id, locationId: packing.id, category: "Mechanical", priority: "HIGH" });
  await jobs.submitAssessment(ctx, j3.id, { findings: "Guide rail bent; needs straightening and lubrication.", quoteRequired: false });
  await jobs.routeInHouse(ctx, j3.id, {});
  await addJobAttachment(ctx, { jobId: j3.id, kind: "REQUEST", filename: "roller-door.jpg", bytes: await samplePhoto(3) });
  await jobs.assignJob(ctx, j3.id, { leadTechnicianId: jabu!.userId, plannedEnd: new Date(Date.now() + 2 * 86_400_000).toISOString(), instructions: "Work before the 07:00 shift starts." });
  await jobs.startWork(jabu!, j3.id);
  await jobs.addWorkUpdate(jabu!, j3.id, { note: "Rail straightened, waiting for lubricant delivery.", labourMinutes: 60 });
  await jobs.requestSpares(jabu!, j3.id, { sparesNeeded: "TO_BUY", sparesList: "Rail lubricant (5 L), 2 × door rollers" });
  await jobs.updateSpares(ctx, j3.id, { action: "ORDERED", note: "Door Parts SA, PO 1187", eta: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) });

  // 4. Contractor appointed (approved with a PO).
  const j4 = await jobs.createJob(ctx, { title: "Forklift 3 hydraulic leak", description: "Oil under the mast after use.", siteId: dc.id, locationId: bay.id, assetId: fork.id, category: "Mechanical", priority: "NORMAL" });
  await jobs.submitAssessment(ctx, j4.id, { findings: "Mast cylinder seal leaking.", quoteRequired: true });
  await quotes.requestQuotes(ctx, j4.id, { contractorIds: [lift.id], scope: "Replace mast cylinder seals and test.", deadline: null });
  const q4 = await quotes.recordQuote(ctx, j4.id, lift.id, { scope: "Reseal mast cylinders, top up hydraulic oil.", priceExclVatCents: 420000, leadTimeDays: 2 });
  await approvals.approveQuote(ctx, q4.id, { poNumber: "PO-1042", exceptionReason: "", comment: "Only approved forklift agent." }, await scribble(4));

  // 5. A complete, signed requisition: reported → received → fixed in-house → confirmed by originator → signed off.
  const j5 = await jobs.createJob(ctx, { title: "Staff kitchen extractor fan very noisy", description: "Grinding noise from the extractor above the stove, getting louder.", siteId: plant.id, locationId: kitchen.id, category: "Mechanical", priority: "NORMAL" }, await scribble(1));
  await jobs.submitAssessment(ctx, j5.id, { findings: "Fan motor bearing worn.", recommendedWork: "Replace bearing, clean filter.", quoteRequired: false }, await scribble(2));
  await jobs.routeInHouse(ctx, j5.id, {});
  await addJobAttachment(ctx, { jobId: j5.id, kind: "BEFORE", filename: "fan-before.jpg", bytes: await samplePhoto(5) });
  await jobs.assignJob(ctx, j5.id, { leadTechnicianId: jabu!.userId, instructions: "Switch off at the isolator first." });
  await jobs.startWork(jabu!, j5.id);
  await addJobAttachment(jabu!, { jobId: j5.id, kind: "AFTER", filename: "fan-after.jpg", bytes: await samplePhoto(6) });
  await jobs.submitCompletion(jabu!, j5.id, { workPerformed: "Replaced the motor bearing, cleaned the grease filter, ran for 30 minutes: quiet.", rootCauses: ["WEAR_AND_TEAR", "AGE_OF_MACHINE"], rootCauseNotes: "Bearing worn after 6 years. Add to the 6-monthly service list.", toolsAndAreaOk: true }, await scribble(3));
  await jobs.confirmFixed(ctx, j5.id, { outcome: "APPROVED", comment: "Quiet now, thank you." }, { signature: { name: "Thandi Mokoena (kitchen supervisor)", dataUrl: await scribble(5) } });
  await jobs.closeJob(ctx, j5.id, {}, await scribble(6));

  // 6. Some history, so Insights and area reports have something to show.
  const past: [string, string, string, ("WEAR_AND_TEAR" | "OPERATOR" | "AGE_OF_MACHINE" | "BREAKDOWN" | "HUMAN_ERROR")[], number][] = [
    ["Cold room door seal torn", plant.id, cold.id, ["WEAR_AND_TEAR"], 75],
    ["Compressor 2 high-pressure alarm", plant.id, cold.id, ["AGE_OF_MACHINE", "BREAKDOWN"], 48],
    ["Cold room light fitting broken", plant.id, cold.id, ["HUMAN_ERROR"], 20],
    ["Packing line conveyor belt slipping", plant.id, packing.id, ["WEAR_AND_TEAR", "OPERATOR"], 33],
    ["Dock leveller not lifting", dc.id, bay.id, ["BREAKDOWN"], 12],
  ];
  for (const [title, siteId, locationId, rootCauses, daysAgo] of past) {
    const j = await jobs.createJob(ctx, { title, description: "Logged on the paper requisition before Resultra.", siteId, locationId, category: "Mechanical", priority: "NORMAL" });
    await jobs.submitAssessment(ctx, j.id, { findings: "Checked on site.", quoteRequired: false });
    await jobs.routeInHouse(ctx, j.id, {});
    await jobs.assignJob(ctx, j.id, { leadTechnicianId: jabu!.userId });
    await jobs.startWork(jabu!, j.id);
    await addJobAttachment(jabu!, { jobId: j.id, kind: "AFTER", filename: "after.jpg", bytes: await samplePhoto(7) });
    await jobs.submitCompletion(jabu!, j.id, { workPerformed: "Repaired and tested.", rootCauses, toolsAndAreaOk: null });
    await jobs.confirmFixed(ctx, j.id, { outcome: "APPROVED", comment: "" });
    await jobs.closeJob(ctx, j.id, {});
    const at = (d: number, h = 0) => new Date(Date.now() - d * 86_400_000 + h * 3_600_000);
    await prisma.job.update({ where: { id: j.id }, data: { reportedAt: at(daysAgo), respondedAt: at(daysAgo, 2), assignedAt: at(daysAgo, 3), startedAt: at(daysAgo, 20), completedAt: at(daysAgo, 26), closedAt: at(daysAgo, 30) } });
    await prisma.completion.updateMany({ where: { jobId: j.id }, data: { completedAt: at(daysAgo, 26) } });
  }

  // 7. Waiting for spend approval: above the manager's limit, so it goes to the finance approver.
  const j7 = await jobs.createJob(grace!, { title: "Packing line 2 gearbox grinding", description: "Loud grinding from the main gearbox on packing line 2, worse at full speed. Smells hot.", siteId: plant.id, locationId: packing.id, category: "Mechanical", priority: "HIGH", departmentId: depts.Operations });
  await addJobAttachment(grace!, { jobId: j7.id, kind: "REQUEST", filename: "gearbox.jpg", bytes: await samplePhoto(8) });
  await departments.handOverJob(pieter!, j7.id, { toDepartmentId: depts.Maintenance!, reason: "Needs maintenance: line can stop from 14:00 for the repair." });
  await jobs.requestAssessment(sipho!, j7.id, { assessorId: jabu!.userId });
  await jobs.submitAssessment(jabu!, j7.id, { findings: "Gearbox bearings failing; oil contaminated.", recommendedWork: "Replace gearbox bearings and seals, flush and refill oil.", quoteRequired: true });
  await quotes.requestQuotes(sipho!, j7.id, { contractorIds: [sparks.id, cool.id], scope: "Recondition packing line 2 gearbox.", deadline: null });
  const q7 = await quotes.recordQuote(sipho!, j7.id, sparks.id, { scope: "Recondition gearbox: bearings, seals, oil.", priceExclVatCents: 1_480_000, leadTimeDays: 2 });
  await quotes.recordQuote(sipho!, j7.id, cool.id, { scope: "Gearbox bearing replacement.", priceExclVatCents: 1_620_000, leadTimeDays: 4 });
  await approvals.recommendQuote(sipho!, q7.id, { poNumber: "", exceptionReason: "Only two specialists available this week.", comment: "Cheapest and earliest. Line 2 is our bottleneck." });

  // 8. Reopened: fixed, closed, then the fault came back within the warranty period.
  const j8 = await jobs.createJob(grace!, { title: "Hand-wash basin blocked in packing hall", description: "Water drains very slowly and backs up.", siteId: plant.id, locationId: packing.id, category: "Plumbing", priority: "NORMAL", departmentId: depts.Maintenance });
  await jobs.submitAssessment(ctx, j8.id, { findings: "Trap blocked with debris.", recommendedWork: "Clear trap and flush line.", quoteRequired: false });
  await jobs.routeInHouse(ctx, j8.id, {});
  await jobs.assignJob(ctx, j8.id, { leadTechnicianId: jabu!.userId });
  await jobs.startWork(jabu!, j8.id);
  await addJobAttachment(jabu!, { jobId: j8.id, kind: "AFTER", filename: "basin-after.jpg", bytes: await samplePhoto(9) });
  await jobs.submitCompletion(jabu!, j8.id, { workPerformed: "Cleared the trap and flushed the line.", rootCauses: ["OPERATOR"], rootCauseNotes: "Gloves rinsed into the basin.", toolsAndAreaOk: null });
  await jobs.confirmFixed(grace!, j8.id, { outcome: "APPROVED", comment: "" });
  await jobs.closeJob(ctx, j8.id, {});
  await jobs.reopenJob(ctx, j8.id, { reason: "Blocked again two days later: the drain line may be partly collapsed." });

  // 9. A report that looks like one already open, for a manager to review.
  await jobs.createPublicReport(plant.publicToken, { title: "Kitchen tap dripping", description: "The hot tap in the staff kitchen keeps dripping and won't close.", reporterName: "Johannes (cleaning team)", reporterPhone: "", reporterEmail: "", locationId: kitchen.id });
  void lerato;

  // Signatures are required from here on, as a company using paper requisitions would expect.
  await prisma.organisation.update({ where: { id: org.id }, data: { requireSignatures: true } });
  return org.id;
}

/** A hand-drawn-looking signature for the sample data (PNG data URL), different per seed. */
async function scribble(seed: number) {
  const r = (i: number) => ((Math.sin(seed * 97 + i * 13.7) + 1) / 2);
  let d = `M 30 ${100 + r(0) * 30}`;
  for (let i = 1; i <= 7; i++) d += ` C ${i * 70 - 40} ${30 + r(i) * 60}, ${i * 70 - 20} ${150 - r(i + 9) * 60}, ${i * 70 + 10} ${90 + r(i + 20) * 40}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><path d="${d}" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round"/><path d="M ${60 + r(30) * 40} 150 L ${420 + r(31) * 100} ${140 + r(32) * 10}" stroke="#111827" stroke-width="3"/></svg>`;
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64")}`;
}

/** A clearly synthetic sample photo (shapes on a background), different per seed. Never a real site photo. */
async function samplePhoto(seed = 1) {
  const hues = ["#64748b", "#78716c", "#6b7280", "#57534e", "#475569", "#71717a", "#5b6b7a", "#6d6a63", "#4b5563"];
  const bg = hues[seed % hues.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="${bg}"/>
    <rect x="${160 + seed * 20}" y="220" width="560" height="420" rx="18" fill="#cbd5e1" opacity="0.85"/>
    <circle cx="${820 - seed * 15}" cy="${380 + seed * 10}" r="150" fill="#f59e0b" opacity="0.8"/>
    <text x="60" y="860" font-family="Inter, Arial" font-size="40" fill="#ffffff" opacity="0.85">Sample photo – demo data</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/**
 * Reset the demo: the current demo company is archived (its audit rows are append-only, so nothing is deleted;
 * the archived company is invisible to everyone) and a fresh one is built. Real companies are never touched.
 */
export async function resetDemoWorkspace(user: { id: string; name: string; email: string }): Promise<string> {
  const m = await prisma.membership.findFirst({ where: { userId: user.id, active: true, roles: { has: "OWNER" }, org: { isDemo: true, archivedAt: null } } });
  if (!m) throw conflict("You do not have a demo workspace to reset.");
  await prisma.$transaction(async (tx) => {
    await tx.organisation.update({ where: { id: m.orgId }, data: { archivedAt: new Date() } });
    await tx.membership.updateMany({ where: { orgId: m.orgId }, data: { active: false } });
    await tx.session.updateMany({ where: { activeOrgId: m.orgId }, data: { activeOrgId: null, actAsUserId: null } });
  });
  return createDemoWorkspace(user);
}

/** The sample people a demonstrator can view as (demo companies only). */
export const listPersonas = (orgId: string) =>
  prisma.membership.findMany({ where: { orgId, active: true, org: { isDemo: true }, user: { demoPersona: true } }, select: { userId: true, roles: true, user: { select: { name: true, jobTitle: true } } }, orderBy: { createdAt: "asc" } });
