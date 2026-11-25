/**
 * Captures real screenshots of a running ManOp instance for the user guides.
 *   BASE=http://localhost:3220 DATABASE_URL=… OUT=docs/screenshots node scripts/guides/capture.cjs
 * It creates its own platform owner, customer company, people and jobs through the real UI (synthetic data only).
 * PDFs (job card, completion report, QR sign) are rendered to images with pdftoppm when available.
 */
const { chromium, devices } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE ?? "http://localhost:3220";
const OUT = path.resolve(process.env.OUT ?? "docs/screenshots");
const PASSWORD = "correct-horse-battery";
const uid = () => Math.random().toString(36).slice(2, 7);
const db = new PrismaClient();
fs.mkdirSync(OUT, { recursive: true });

let browser;
const ctxs = [];
async function page({ mobile = false } = {}) {
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  const c = await browser.newContext({ ...(mobile ? devices["iPhone 13"] : { viewport: { width: 1280, height: 860 } }), deviceScaleFactor: mobile ? 2 : 1.5, extraHTTPHeaders: { "x-forwarded-for": ip } });
  ctxs.push(c);
  const p = await c.newPage();
  p.on("dialog", (d) => d.accept());
  return p;
}
const go = async (p, url) => { await p.goto(BASE + url); await p.waitForLoadState("networkidle"); };
const shot = async (p, name, opts = {}) => { await p.waitForTimeout(250); await p.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }); console.log("shot", name); };
const el = async (p, selector, name) => { await p.locator(selector).first().scrollIntoViewIfNeeded(); await p.locator(selector).first().screenshot({ path: path.join(OUT, `${name}.png`) }); console.log("shot", name); };
const f = (p, name) => p.locator(`:is(input,select,textarea)[name="${name}"]`);
const next = (p) => p.getByRole("button", { name: "Next →" }).click();
const panel = async (p, label) => { const d = p.locator("details.action", { has: p.locator("summary", { hasText: label }) }); if ((await d.getAttribute("open")) === null) await d.locator("summary").click(); return d; };
async function signIn(email, mobile = false) {
  const p = await page({ mobile });
  await go(p, "/login");
  await f(p, "email").fill(email); await f(p, "password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForLoadState("networkidle"); await p.waitForTimeout(800);
  return p;
}
async function pdfToPng(url, p, name, pages = "1") {
  const res = await p.request.get(BASE + url);
  const file = path.join(OUT, `${name}.pdf`);
  fs.writeFileSync(file, await res.body());
  try {
    const [first, last] = pages.split("-");
    execFileSync("pdftoppm", ["-r", "70", "-png", "-f", first, "-l", last ?? first, file, path.join(OUT, name)]);
    for (const x of fs.readdirSync(OUT)) if (x.startsWith(`${name}-`) && x.endsWith(".png")) fs.renameSync(path.join(OUT, x), path.join(OUT, x.replace(/-0*(\d+)\.png$/, "-p$1.png")));
  } catch (e) { console.warn("pdftoppm not available:", e.message); }
  fs.unlinkSync(file);
}

(async () => {
  browser = await chromium.launch();
  // ---------- Platform owner
  const opEmail = `platform-${uid()}@guide.example`;
  await db.user.create({ data: { email: opEmail, name: "ManOp Operator", passwordHash: await bcrypt.hash(PASSWORD, 6), isPlatformAdmin: true, emailVerifiedAt: new Date() } });
  const op = await signIn(opEmail);
  const company = `Spanjaard Pilot ${uid().toUpperCase()}`;
  const adminEmail = `bongi-${uid()}@guide.example`;
  await f(op, "companyName").fill(company); await f(op, "siteName").fill("Alrode Plant"); await f(op, "siteAddress").fill("21 Steel Road, Alrode");
  await f(op, "contactName").fill("Bongi Khumalo"); await f(op, "contactEmail").fill(adminEmail); await f(op, "phone").fill("011 555 0100");
  await shot(op, "platform-create");
  await op.getByRole("button", { name: "Create company and invite contact" }).click();
  await op.getByText("Invitation sent").waitFor();
  const org = await db.organisation.findFirstOrThrow({ where: { name: company } });
  const invite = (await db.outboxEmail.findFirstOrThrow({ where: { toEmail: adminEmail }, orderBy: { createdAt: "desc" } })).body.match(/\/invite\/[A-Za-z0-9_-]{43}/)[0];

  // ---------- Site administrator accepts the invitation
  const admin = await page();
  await go(admin, invite);
  await shot(admin, "invite-accept");
  await f(admin, "name").fill("Bongi Khumalo").catch(() => {});
  await f(admin, "password").fill(PASSWORD);
  await admin.getByRole("button", { name: "Accept invitation" }).click();
  await admin.waitForURL(/dashboard/); await admin.waitForLoadState("networkidle");
  await db.user.update({ where: { email: adminEmail }, data: { emailVerifiedAt: new Date() } }); // as if the link was clicked
  const site = await db.site.findFirstOrThrow({ where: { orgId: org.id } });
  await go(admin, `/sites/${site.id}`);
  for (const area of ["Workshop", "Warehouse", "Production"]) {
    await admin.getByPlaceholder("Add a location, e.g. Plant room").fill(area);
    await admin.getByRole("button", { name: "Add location" }).click();
    await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(600);
  }
  await go(admin, "/settings");
  await f(admin, "publicReportingEnabled").check();
  await admin.getByRole("button", { name: "Save company settings" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  await go(admin, `/sites/${site.id}`);
  await shot(admin, "site-page", { fullPage: true });
  await pdfToPng(`/api/sites/${site.id}/signs`, admin, "qr-sign", "2");

  // Registration code and an employee asking to join
  await go(admin, "/settings");
  await admin.locator("section.card", { hasText: "Registration codes" }).getByRole("button", { name: "Create code" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  await el(admin, 'section.card:has(h2:text-is("Registration codes"))', "settings-codes");
  await el(admin, 'section.card:has(h2:text-is("Departments"))', "settings-departments");
  const code = (await admin.getByTestId("join-code").first().textContent()).trim();
  const emp = await page({ mobile: true });
  await go(emp, `/join?code=${code}`);
  const empEmail = `jabu-${uid()}@guide.example`;
  await f(emp, "name").fill("Jabu Mokoena"); await f(emp, "email").fill(empEmail); await f(emp, "password").fill(PASSWORD);
  await f(emp, "departmentId").selectOption({ label: "Maintenance" });
  await shot(emp, "join-form", { fullPage: true });
  await emp.getByRole("button", { name: "Ask for access" }).click();
  await emp.getByTestId("pending-approval").waitFor();
  await shot(emp, "join-pending");
  await db.user.update({ where: { email: empEmail }, data: { emailVerifiedAt: new Date() } });
  await go(admin, "/settings");
  await el(admin, "#approvals", "settings-approvals");
  const req = admin.getByTestId("approvals").locator("li", { hasText: "Jabu Mokoena" });
  await req.getByLabel("Technician").check(); await req.getByLabel("Reports faults only").uncheck();
  await req.getByRole("button", { name: "Approve access" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  // Operations manager (department manager)
  const ops = await page();
  await go(ops, `/join?code=${code}`);
  const opsEmail = `pieter-${uid()}@guide.example`;
  await f(ops, "name").fill("Pieter van Wyk"); await f(ops, "email").fill(opsEmail); await f(ops, "password").fill(PASSWORD);
  await f(ops, "departmentId").selectOption({ label: "Operations" });
  await ops.getByRole("button", { name: "Ask for access" }).click(); await ops.getByTestId("pending-approval").waitFor();
  await db.user.update({ where: { email: opsEmail }, data: { emailVerifiedAt: new Date() } });
  await go(admin, "/settings");
  const r2 = admin.getByTestId("approvals").locator("li", { hasText: "Pieter van Wyk" });
  await r2.getByLabel("Department manager").check();
  await r2.getByRole("button", { name: "Approve access" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);

  // ---------- QR report on a phone (anyone, no account)
  const loc = await db.location.findFirstOrThrow({ where: { orgId: org.id, name: "Workshop" } });
  const anon = await page({ mobile: true });
  await go(anon, `/r/${loc.publicCode}`);
  await shot(anon, "qr-1-start");
  await anon.getByText("Leaking", { exact: true }).click();
  await f(anon, "description").fill("Compressed air line hissing at the drop next to the lathe");
  await next(anon); await shot(anon, "qr-2-urgency");
  await anon.locator('[data-testid="priority-choice"] input[value="HIGH"]').check();
  await next(anon); await shot(anon, "qr-3-place");
  await next(anon);
  const sample = path.join(OUT, "_sample.jpg");
  await require("sharp")({ create: { width: 1200, height: 900, channels: 3, background: "#64748b" } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect x="200" y="250" width="600" height="380" rx="20" fill="#cbd5e1"/><circle cx="820" cy="420" r="150" fill="#f59e0b"/><text x="60" y="860" font-size="40" fill="#fff" font-family="Arial">Sample photo – demo data</text></svg>'), top: 0, left: 0 }]).jpeg().toFile(sample);
  await anon.locator('input[name="photos"]').setInputFiles(sample);
  await next(anon);
  await f(anon, "reporterName").fill("Sam Visitor");
  await next(anon); await shot(anon, "qr-5-review", { fullPage: true });
  await anon.getByRole("button", { name: "Send report" }).click();
  await anon.getByTestId("report-done").waitFor(); await shot(anon, "qr-6-done");

  // ---------- Signed-in report and a likely duplicate
  await go(admin, "/requests/new");
  await f(admin, "title").fill("Workshop air line leaking at the lathe drop");
  await f(admin, "description").fill("Air hissing from the quick coupler at the drop beside lathe 2.");
  await shot(admin, "report-step1");
  await next(admin); await next(admin);
  await f(admin, "locationId").selectOption({ label: "Workshop" }).catch(() => {});
  await next(admin);
  await admin.locator("#files").setInputFiles(sample);
  await next(admin);
  await admin.getByRole("button", { name: "Send report" }).click();
  await admin.waitForURL(/jobs\/[0-9a-f-]{36}$/); await admin.waitForLoadState("networkidle");
  const dupUrl = new URL(admin.url()).pathname;
  await el(admin, '[data-testid="related-reports"]', "duplicate-review").catch(() => console.warn("no duplicate card"));
  const original = await db.job.findFirstOrThrow({ where: { orgId: org.id, source: "PUBLIC_LINK" } });

  // ---------- Manager: triage, assess, department, handover, assign
  await go(admin, `/jobs/${original.id}`);
  await shot(admin, "job-page");
  const a = await panel(admin, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Quick coupler O-ring perished; line pressure OK.");
  await a.locator('[name="recommendedWork"]').fill("Replace coupler and O-ring, leak-test with soapy water.");
  await a.locator('[name="quoteRequired"]').selectOption("no");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  const h = await panel(admin, "Hand over this job");
  await h.locator('[name="toDepartmentId"]').selectOption({ label: "Operations" });
  await h.locator('[name="reason"]').fill("Production must stop lathe 2 for 30 minutes before we can work on the line.");
  await el(admin, '[data-testid="department-card"]', "handover-form");
  await h.getByRole("button", { name: "Hand over" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  const opsPage = await signIn(opsEmail);
  await go(opsPage, "/dashboard"); await shot(opsPage, "department-queue");
  await (await panel(admin, "Fix it in-house")).getByRole("button", { name: "Give to the in-house team" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  const as = await panel(admin, "Assign a technician");
  await as.locator('[name="leadTechnicianId"]').selectOption({ label: "Jabu Mokoena" });
  await as.locator('[name="instructions"]').fill("Isolate the air at the ring main valve first.").catch(() => {});
  await as.getByRole("button", { name: "Assign job" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(800);
  await el(admin, '[data-testid="documents"]', "documents-card");
  await pdfToPng(`/api/jobs/${original.id}/documents/card`, admin, "jobcard", "1-2");

  // ---------- Technician on a phone
  const tech = await signIn(empEmail, true);
  await go(tech, `/jobs/${original.id}`);
  await shot(tech, "tech-job");
  await tech.getByRole("button", { name: "Start work" }).click();
  await tech.waitForLoadState("networkidle"); await tech.waitForTimeout(800);
  const done = await panel(tech, "Work finished – submit evidence");
  await done.locator('[name="workPerformed"]').fill("Replaced the quick coupler and O-ring; leak-tested, no hiss.");
  await next(tech);
  await done.locator('[name="after"]').setInputFiles(sample);
  await next(tech);
  await done.getByTestId("root-causes").getByLabel("Wear and tear", { exact: true }).check();
  await next(tech);
  await shot(tech, "tech-completion-review", { fullPage: true });
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await tech.waitForLoadState("networkidle"); await tech.waitForTimeout(800);

  // ---------- Manager confirms (on behalf of the QR reporter) and closes
  await go(admin, `/jobs/${original.id}`);
  // QR reports have no account to confirm with, so the manager confirms and closes in one step.
  const c = await panel(admin, "Confirm fixed, sign off and close");
  await c.locator('[name="comment"]').fill("Checked on site with the workshop supervisor.");
  await c.getByRole("button", { name: "Sign off and close" }).click();
  await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(1000);
  await pdfToPng(`/api/jobs/${original.id}/documents/completion`, admin, "completion", "1");
  await pdfToPng(`/api/jobs/${original.id}/documents/history`, admin, "history", "1");

  // ---------- Dashboard, board, department queue, platform views
  await go(admin, "/dashboard"); await shot(admin, "dashboard");
  await go(admin, "/jobs"); await shot(admin, "jobs-board");
  await go(admin, dupUrl); await shot(admin, "duplicate-job");
  await go(op, "/platform"); await shot(op, "platform-overview");
  await go(op, `/platform/${org.id}`); await shot(op, "platform-customer", { fullPage: true });
  await go(admin, "/sites"); await go(admin, `/sites/${site.id}/qr`); await shot(admin, "qr-stickers");
  await go(admin, `/jobs/${original.id}/card`); await shot(admin, "card-viewer");
  await go(emp, "/login"); await shot(emp, "login-phone");

  // ---------- Demo with "view as"
  const demoUser = await page();
  await go(demoUser, "/register");
  await f(demoUser, "companyName").fill(`Demo Guide ${uid()}`); await f(demoUser, "name").fill("Dana Demo");
  await f(demoUser, "email").fill(`dana-${uid()}@guide.example`); await f(demoUser, "password").fill(PASSWORD);
  await demoUser.getByRole("button", { name: "Create account" }).click();
  await demoUser.waitForURL(/dashboard/); await demoUser.waitForLoadState("networkidle");
  await demoUser.getByRole("button", { name: "Explore a demo workspace" }).click();
  await demoUser.getByTestId("demo-bar").waitFor({ timeout: 90_000 });
  await shot(demoUser, "demo-dashboard");
  await f(demoUser, "personaId").selectOption({ label: "Finance manager – Lerato Botha" });
  await demoUser.getByRole("button", { name: "View as" }).click();
  await demoUser.getByTestId("viewing-as").waitFor(); await demoUser.waitForLoadState("networkidle");
  await shot(demoUser, "demo-view-as");

  fs.unlinkSync(sample);
  for (const c2 of ctxs) await c2.close();
  await browser.close(); await db.$disconnect();
  console.log("done");
})().catch(async (e) => { console.error("CAPTURE FAILED:", e); try { await browser?.close(); } catch {} await db.$disconnect(); process.exit(1); });
