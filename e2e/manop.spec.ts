/**
 * ManOp pilot acceptance: the 20 required scenarios (S1–S20) and the job document tests (D1–D7).
 * Each test sets up its own company, so they can run in any order.
 */
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import {
  acceptInvite, addContractor, card, company, db, f, gotoReady, invite, lastEmail, logRequest, newPage, next, openPanel, PASSWORD, pathFrom, status, uid, verifyEmail,
} from "./helpers";

test.afterAll(async () => { await db.$disconnect(); });

const PHOTO = "public/icon-192.png";
const orgOf = async (email: string) => (await db.membership.findFirstOrThrow({ where: { user: { email } }, orderBy: { createdAt: "asc" } })).orgId;
const jobIdOf = (url: string) => url.split("/").pop()!;

async function signIn(b: Browser, email: string, nextPath?: string, password = PASSWORD) {
  const p = await newPage(b);
  await gotoReady(p, nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  await f(p, "email").fill(email);
  await f(p, "password").fill(password);
  await p.getByRole("button", { name: "Sign in" }).click();
  return p;
}

async function platformAdmin() {
  const email = `platform-${uid()}@e2e.example`;
  await db.user.create({ data: { email, name: "ManOp Operator", passwordHash: await bcrypt.hash(PASSWORD, 6), isPlatformAdmin: true, emailVerifiedAt: new Date() } });
  return email;
}

/** Owner assesses (in-house), assigns themself, starts and completes with an after photo. */
async function workToCompletion(p: Page, jobUrl: string) {
  await gotoReady(p, jobUrl);
  const a = await openPanel(p, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Checked on site.");
  await a.locator('[name="quoteRequired"]').selectOption("no");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status(p)).toHaveText("Assessed – decide how to fix");
  await (await openPanel(p, "Fix it in-house")).getByRole("button", { name: "Give to the in-house team" }).click();
  const as = await openPanel(p, "Assign a technician");
  await as.locator('[name="leadTechnicianId"]').selectOption({ index: 1 });
  await as.getByRole("button", { name: "Assign job" }).click();
  await expect(status(p)).toHaveText("Assigned");
  await p.getByRole("button", { name: "Start work" }).click();
  await expect(status(p)).toHaveText("In progress");
  const done = await openPanel(p, "Work finished – submit evidence");
  await done.locator('[name="workPerformed"]').fill("Repaired and tested.");
  await next(done);
  await done.locator('[name="after"]').setInputFiles(PHOTO);
  await next(done);
  await done.getByTestId("root-causes").getByLabel("Wear and tear", { exact: true }).check();
  await next(done);
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(status(p)).toHaveText("Awaiting confirmation");
}

async function confirmAndClose(p: Page) {
  const yes = await openPanel(p, "Is it fixed?");
  await yes.locator('[name="outcome"]').selectOption("APPROVED");
  await yes.getByRole("button", { name: "Send my answer" }).click();
  await expect(status(p)).toHaveText("Confirmed fixed – ready to close");
  await (await openPanel(p, "Sign off and close")).getByRole("button", { name: "Sign off and close" }).click();
  await expect(status(p)).toHaveText("Closed");
}

async function enablePublicReporting(p: Page) {
  await gotoReady(p, "/settings");
  await f(p, "publicReportingEnabled").check();
  await p.getByRole("button", { name: "Save company settings" }).click();
  await expect(p.getByText("Company settings saved.")).toBeVisible();
}

async function addDepartments(p: Page, names: string[]) {
  await gotoReady(p, "/settings");
  for (const n of names) {
    await p.getByPlaceholder("e.g. Operations").fill(n);
    await p.getByRole("button", { name: "Add department" }).click();
    await expect(p.getByTestId("departments")).toContainText(n);
  }
}

/** Owner creates a registration code; an employee asks to join with it. Returns the employee's page and email. */
async function registerEmployee(b: Browser, owner: Page, name: string, department?: string) {
  await gotoReady(owner, "/settings");
  await card(owner, "Registration codes").getByRole("button", { name: "Create code" }).click();
  await expect(owner.getByTestId("join-code").first()).toBeVisible();
  const code = (await owner.getByTestId("join-code").first().textContent())!.trim();
  const email = `${name.split(" ")[0]!.toLowerCase()}-${uid()}@e2e.example`;
  const emp = await newPage(b, { mobile: true });
  await gotoReady(emp, "/join");
  await f(emp, "code").fill(code.toLowerCase());
  await emp.getByRole("button", { name: "Continue" }).click();
  await f(emp, "name").fill(name);
  await f(emp, "email").fill(email);
  await f(emp, "password").fill(PASSWORD);
  if (department) await f(emp, "departmentId").selectOption({ label: department });
  await emp.getByText("Optional: job title, phone number and photo").click();
  await f(emp, "jobTitle").fill("Shift supervisor");
  await emp.getByRole("button", { name: "Ask for access" }).click();
  await expect(emp.getByTestId("pending-approval")).toBeVisible();
  return { emp, email, code };
}

async function readPdf(bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages: { text: string; width: number; height: number; images: number; links: string[] }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ");
    const ops = await page.getOperatorList();
    const links = (await page.getAnnotations()).map((a: { url?: string }) => a.url).filter((u: string | undefined): u is string => !!u);
    pages.push({ text, width: vp.width, height: vp.height, images: ops.fnArray.filter((x: number) => x === pdfjs.OPS.paintImageXObject).length, links });
  }
  return { pages, text: pages.map((x) => x.text).join(" \n ") };
}
const pdfOf = async (p: Page, url: string) => {
  const res = await p.request.get(url);
  expect(res.status(), await res.text().catch(() => "")).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  return { res, pdf: await readPdf(await res.body()) };
};

// ---------------------------------------------------------------- the 20 required scenarios

test("S1 · platform administrator signs in to the platform admin area; other people cannot open it", async ({ browser }) => {
  const admin = await signIn(browser, await platformAdmin());
  await expect(admin).toHaveURL(/\/platform$/);
  await expect(admin.getByText("Platform admin", { exact: true })).toBeVisible();
  await expect(admin.getByRole("heading", { name: /Customer companies/ })).toBeVisible();
  const { p } = await company(browser);
  await gotoReady(p, "/platform");
  await expect(p).toHaveURL(/forbidden/);
});

test("S2 · the platform owner creates a customer company with its first site and departments", async ({ browser }) => {
  const admin = await signIn(browser, await platformAdmin());
  const name = `Spanjaard Pilot ${uid()}`;
  await f(admin, "companyName").fill(name);
  await f(admin, "siteName").fill("Alrode Plant");
  await f(admin, "contactName").fill("Bongi Khumalo");
  await f(admin, "contactEmail").fill(`bongi-${uid()}@e2e.example`);
  await admin.getByRole("button", { name: "Create company and invite contact" }).click();
  await expect(admin.getByText("Invitation sent")).toBeVisible();
  const org = await db.organisation.findFirstOrThrow({ where: { name }, include: { subscription: true } });
  expect(org.subscription?.status).toBe("TRIALING");
  expect(await db.site.count({ where: { orgId: org.id, name: "Alrode Plant" } })).toBe(1);
  expect(await db.department.count({ where: { orgId: org.id } })).toBe(4);
  await gotoReady(admin, "/platform");
  await expect(admin.getByTestId("customers")).toContainText(name);
  await expect(admin.getByTestId("customers")).toContainText("Invitation not accepted");
});

test("S3 · a site administrator adds a site; it gets a short QR link and printable QR signs", async ({ browser }) => {
  const { p, sitePath } = await company(browser);
  await gotoReady(p, sitePath);
  expect(await p.getByTestId("site-report-link").inputValue()).toMatch(/\/r\/[a-z2-9]{10}$/); // no database ids in public links
  const res = await p.request.get(`/api/sites/${sitePath.split("/").pop()}/signs`);
  expect(res.status()).toBe(200);
  const pdf = await readPdf(await res.body());
  expect(pdf.pages).toHaveLength(2); // the site and its area
  expect(pdf.text).toContain("Need to report a maintenance issue?");
  expect(pdf.text).toContain("Cold Room 2");
});

test("S4 · the main contact accepts the platform invitation and becomes the site administrator", async ({ browser }) => {
  const admin = await signIn(browser, await platformAdmin());
  const name = `Invite Co ${uid()}`;
  const email = `contact-${uid()}@e2e.example`;
  await f(admin, "companyName").fill(name);
  await f(admin, "siteName").fill("Main Site");
  await f(admin, "contactName").fill("Neo Contact");
  await f(admin, "contactEmail").fill(email);
  await admin.getByRole("button", { name: "Create company and invite contact" }).click();
  await expect(admin.getByText("Invitation sent")).toBeVisible();
  const contact = await acceptInvite(browser, pathFrom((await lastEmail(email, /ready/)).body, "invite"));
  await expect(contact.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await gotoReady(contact, "/settings");
  await expect(contact.getByText("Registration codes")).toBeVisible(); // administrator tools
  await gotoReady(admin, "/platform");
  await expect(admin.getByTestId("customers").locator("li", { hasText: name })).toContainText("Contact: Neo Contact");
});

test("S5 · an employee registers with a site code and waits for approval without seeing company data", async ({ browser }) => {
  const { p } = await company(browser);
  await addDepartments(p, ["Operations"]);
  const { emp } = await registerEmployee(browser, p, "Nomsa Dube", "Operations");
  await expect(emp.getByTestId("pending-approval")).toContainText("Confirm your email address");
  await gotoReady(emp, "/dashboard");
  await expect(emp).toHaveURL(/no-access/);
  await gotoReady(emp, "/jobs");
  await expect(emp).toHaveURL(/no-access/);
  await gotoReady(emp, "/join?code=WRONG-CODE");
  await expect(emp.locator("p[role=alert]")).toContainText("not valid");
});

test("S6 · the administrator approves the employee (after email confirmation) with a role and department", async ({ browser }) => {
  const { p } = await company(browser);
  await addDepartments(p, ["Maintenance"]);
  const { emp, email } = await registerEmployee(browser, p, "Kagiso Molefe", "Maintenance");
  await gotoReady(p, "/settings");
  const req = p.getByTestId("approvals").locator("li", { hasText: "Kagiso Molefe" });
  await expect(req).toContainText("Email not confirmed yet");
  await verifyEmail(emp, email);
  await gotoReady(p, "/settings");
  await req.getByLabel("Technician").check();
  await req.getByLabel("Reports faults only").uncheck();
  await req.getByRole("button", { name: "Approve access" }).click();
  await expect(p.getByText("Access approved")).toBeVisible();
  await gotoReady(emp, "/dashboard");
  await expect(emp).toHaveURL(/dashboard/);
  await gotoReady(emp, "/profile");
  await expect(emp.getByText("Department: Maintenance")).toBeVisible();
  await expect(f(emp, "jobTitle")).toHaveValue("Shift supervisor"); // captured at registration, no second onboarding
});

test("S7 · department permissions: a department manager sees their department's work, not another's", async ({ browser }) => {
  const { p, email } = await company(browser);
  await addDepartments(p, ["Maintenance", "Operations"]);
  const opsEmail = `olga-${uid()}@e2e.example`;
  const link = await invite(p, opsEmail, "Olga Ops", ["REQUESTER"]);
  const olga = await acceptInvite(browser, link);
  await gotoReady(p, "/settings");
  const ops = p.getByTestId("departments").locator("li", { hasText: "Operations" }).first();
  await ops.locator('[name="userId"]').selectOption({ label: "Olga Ops" });
  await ops.getByLabel("Department manager").check();
  await ops.getByRole("button", { name: "Save" }).click();
  await expect(ops.locator(".badge", { hasText: "Department manager" })).toBeVisible(); // shown after the page reloads
  const mJob = await logRequest(p, "Pump seal leaking", async (q) => { await f(q, "departmentId").selectOption({ label: "Maintenance" }); });
  const oJob = await logRequest(p, "Line 3 guard missing", async (q) => { await f(q, "departmentId").selectOption({ label: "Operations" }); });
  await gotoReady(olga, "/dashboard"); // fresh session data after being added
  await expect(olga.getByTestId("department-queue")).toContainText("Line 3 guard missing");
  await expect(olga.getByTestId("department-queue")).not.toContainText("Pump seal leaking");
  const notFound = await olga.goto(mJob);
  expect(notFound?.status()).toBe(404);
  await gotoReady(olga, oJob);
  await expect(olga.getByRole("heading", { level: 1 })).toHaveText("Line 3 guard missing");
  expect(await db.job.count({ where: { orgId: await orgOf(email) } })).toBe(2);
});

test("S8 · public QR reporting from an area code: no login, the area is known, a name is enough", async ({ browser }) => {
  const { p, email } = await company(browser);
  await enablePublicReporting(p);
  const loc = await db.location.findFirstOrThrow({ where: { orgId: await orgOf(email), name: "Cold Room 2" } });
  const anon = await newPage(browser, { mobile: true });
  await gotoReady(anon, `/r/${loc.publicCode}`);
  await expect(anon.getByTestId("report-site")).toContainText("Cold Room 2");
  await expect(anon.getByRole("note")).toContainText("emergency procedure");
  await anon.getByText("Leaking", { exact: true }).click();
  await f(anon, "description").fill("Water pooling under the evaporator");
  await next(anon); await next(anon);
  await expect(anon.getByTestId("place-confirm")).toContainText("Cold Room 2");
  await next(anon);
  await anon.locator('input[name="photos"]').setInputFiles(PHOTO);
  await next(anon);
  await f(anon, "reporterName").fill("Sam Visitor");
  await next(anon);
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.getByTestId("report-number")).toHaveText(/^REQ-\d{5}$/);
  const job = await db.job.findFirstOrThrow({ where: { orgId: await orgOf(email), source: "PUBLIC_LINK" }, include: { attachments: true } });
  expect(job).toMatchObject({ locationId: loc.id, reporterName: "Sam Visitor", reporterPhone: null });
  expect(job.attachments.filter((a) => a.kind === "REQUEST")).toHaveLength(1);
});

test("S9 · incorrect or abusive public submissions are refused without creating jobs", async ({ browser }) => {
  const { p, email, sitePath } = await company(browser);
  await enablePublicReporting(p);
  const orgId = await orgOf(email);
  await gotoReady(p, sitePath);
  const reportPath = new URL(await p.getByTestId("site-report-link").inputValue()).pathname;
  const anon = await newPage(browser, { mobile: true });
  await gotoReady(anon, "/r/zzzzzzzzzz");
  await expect(anon.getByText("This report link is not active")).toBeVisible();
  await gotoReady(anon, reportPath);
  await next(anon);
  await expect(anon.getByTestId("step-label")).toContainText("Step 1 of 6"); // a description is required
  const html = '<img src=x onerror="window.__pwned=1">Door broken';
  await f(anon, "description").fill(html);
  await next(anon); await next(anon); await next(anon);
  await anon.locator('input[name="photos"]').setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("%PDF-1.4 not a photo") });
  await next(anon);
  await f(anon, "reporterName").fill("Mallory");
  await f(anon, "reporterPhone").fill("12");
  await next(anon);
  await expect(anon.getByTestId("step-label")).toContainText("Step 5 of 6"); // a too-short phone number is caught before sending
  await f(anon, "reporterPhone").fill("");
  await next(anon);
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.locator("p[role=alert]")).toContainText("Only JPEG, PNG or WebP images"); // a disguised file is refused by the server
  expect(await db.job.count({ where: { orgId } })).toBe(0);
  // Spam trap filled in by a bot: "thank you", but nothing stored.
  await anon.evaluate(() => { (document.querySelector('input[name="website"]') as HTMLInputElement).value = "http://spam.example"; });
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.getByTestId("report-done")).toBeVisible();
  expect(await db.job.count({ where: { orgId } })).toBe(0);
  // A real report with HTML in it is stored as text and shown as text.
  await gotoReady(anon, reportPath);
  await f(anon, "description").fill(html);
  await next(anon); await next(anon); await next(anon); await next(anon);
  await f(anon, "reporterName").fill("Real Person");
  await next(anon);
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.getByTestId("report-done")).toBeVisible();
  const job = await db.job.findFirstOrThrow({ where: { orgId } });
  await gotoReady(p, `/jobs/${job.id}`);
  await expect(p.getByText(html).first()).toBeVisible();
  expect(await p.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("S10 · duplicate reports are flagged for review and a manager links them without losing the original reports", async ({ browser }) => {
  const { p } = await company(browser);
  const first = await logRequest(p, "Compressor 2 tripping on overload");
  const second = await logRequest(p, "Compressor 2 keeps tripping on overload again");
  await expect(p.getByText("Possible duplicate").first()).toBeVisible();
  const review = p.getByTestId("duplicate-review");
  await expect(review).toContainText("Compressor 2 tripping on overload");
  await gotoReady(p, "/dashboard");
  await expect(p.locator("a.card", { hasText: "Possible duplicates to review" })).toContainText("1");
  await gotoReady(p, second);
  await review.getByRole("button", { name: /Link as duplicate of/ }).click();
  await expect(status(p)).toHaveText("Cancelled");
  await expect(p.getByTestId("duplicate-of")).toBeVisible();
  await gotoReady(p, first);
  await expect(p.getByTestId("related-reports")).toContainText("Duplicate reports linked to this job (1)");
  expect(await db.job.findUniqueOrThrow({ where: { id: jobIdOf(second) } })).toMatchObject({ duplicateStatus: "LINKED", duplicateOfId: jobIdOf(first) });
});

test("S11 · triage: a manager changes the urgency and sends a new report for assessment", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Fire door does not latch");
  const prio = await openPanel(p, "Change urgency");
  await prio.locator('[name="priority"]').selectOption("CRITICAL");
  await prio.getByRole("button", { name: "Save" }).click();
  await expect(p.locator(".badge", { hasText: "Critical" }).first()).toBeVisible();
  const send = await openPanel(p, "Send for assessment");
  await send.locator('[name="assessorId"]').selectOption({ index: 1 });
  await send.getByRole("button", { name: "Send for assessment" }).click();
  await expect(status(p)).toHaveText("Awaiting assessment");
  expect(await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) } })).toMatchObject({ priority: "CRITICAL", status: "ASSESSING" });
});

test("S12 · department handover records who, to whom, why and when, and updates the job", async ({ browser }) => {
  const { p } = await company(browser);
  await addDepartments(p, ["Maintenance", "Operations"]);
  const url = await logRequest(p, "Conveyor guard rattling", async (q) => { await f(q, "departmentId").selectOption({ label: "Maintenance" }); });
  await expect(p.getByTestId("job-department")).toHaveText("Maintenance");
  const h = await openPanel(p, "Hand over this job");
  await h.locator('[name="toDepartmentId"]').selectOption({ label: "Operations" });
  await h.locator('[name="reason"]').fill("Production must stop the line before we can work on it");
  await h.getByRole("button", { name: "Hand over" }).click();
  await expect(p.getByText("Job handed over.")).toBeVisible();
  await gotoReady(p, url);
  await expect(p.getByTestId("job-department")).toHaveText("Operations");
  await expect(p.getByTestId("timeline")).toContainText("Handed over to Operations: Production must stop the line");
  expect(await db.jobHandover.count({ where: { jobId: jobIdOf(url) } })).toBe(1);
});

test("S13 · a notification email links to the job; signed-out people sign in and land on that job", async ({ browser }) => {
  const { p, email } = await company(browser);
  await enablePublicReporting(p);
  const site = await db.site.findFirstOrThrow({ where: { orgId: await orgOf(email) } });
  const anon = await newPage(browser, { mobile: true });
  await gotoReady(anon, `/r/${site.publicCode}`);
  await f(anon, "description").fill("Office aircon dripping on desks");
  await next(anon); await next(anon); await next(anon); await next(anon);
  await f(anon, "reporterName").fill("Lindiwe");
  await next(anon);
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.getByTestId("report-done")).toBeVisible();
  const mail = await lastEmail(email, /New public report/);
  const link = /https?:\/\/\S+\/jobs\/[0-9a-f-]{36}/.exec(mail.body)![0];
  const path = new URL(link).pathname;
  const fresh = await newPage(browser);
  await gotoReady(fresh, path);
  await expect(fresh).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[-/]/g, "\\$&")}`));
  await f(fresh, "email").fill(email);
  await f(fresh, "password").fill(PASSWORD);
  await fresh.getByRole("button", { name: "Sign in" }).click();
  await expect(fresh).toHaveURL(new RegExp(`${path}$`));
  await expect(fresh.getByRole("heading", { level: 1 })).toContainText("Office aircon dripping");
  const evil = await signIn(browser, email, "//evil.example/steal");
  await expect(evil).toHaveURL(/\/dashboard$/); // never sent to another site
});

test("S14 · quotation workflow: capture a contractor's quote, approve within the limit, contractor appointed", async ({ browser }) => {
  const { p } = await company(browser);
  await addContractor(p, "CoolTech Refrigeration", `cool-${uid()}@contractor.example`, true);
  const url = await logRequest(p, "Cold room compressor noisy");
  const a = await openPanel(p, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Bearing noise from the compressor.");
  await a.locator('[name="quoteRequired"]').selectOption("yes");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status(p)).toHaveText("Assessed – decide how to fix");
  const q = await openPanel(p, "Capture a quote received by email");
  await q.locator('[name="contractorId"]').selectOption({ index: 1 }); // the only contractor
  await q.locator('[name="scope"]').fill("Replace compressor bearings and test.");
  await q.locator('[name="price"]').fill("3200");
  await q.getByRole("button", { name: "Save quote" }).click();
  await expect(status(p)).toHaveText("Getting quotes");
  const choose = p.getByTestId("choose-CoolTech Refrigeration");
  await choose.locator("summary").click();
  await choose.getByRole("button", { name: "Approve and appoint contractor" }).click();
  await expect(status(p)).toHaveText("Assigned");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) }, include: { quotes: true } });
  expect(job.route).toBe("CONTRACTOR");
  expect(job.quotes[0]).toMatchObject({ status: "APPROVED", totalCents: 368000 }); // R3 200 + 15 % VAT
});

test("S15 · technician job execution on a phone: start work and log progress", async ({ browser }) => {
  const { p } = await company(browser);
  const techEmail = `tech-${uid()}@e2e.example`;
  const tech = await acceptInvite(browser, await invite(p, techEmail, "Tumi Tech", ["TECHNICIAN"]), true);
  const url = await logRequest(p, "Loading bay light flickering");
  const a = await openPanel(p, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Ballast failing.");
  await a.locator('[name="quoteRequired"]').selectOption("no");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await (await openPanel(p, "Fix it in-house")).getByRole("button", { name: "Give to the in-house team" }).click();
  const as = await openPanel(p, "Assign a technician");
  await as.locator('[name="leadTechnicianId"]').selectOption({ label: "Tumi Tech" });
  await as.getByRole("button", { name: "Assign job" }).click();
  await expect(status(p)).toHaveText("Assigned");
  await gotoReady(tech, url); // the technician opens their assigned job
  await tech.getByRole("button", { name: "Start work" }).click();
  await expect(status(tech)).toHaveText("In progress");
  const upd = await openPanel(tech, "Add update / note");
  await upd.locator('[name="note"]').fill("Ballast ordered, temporary lamp fitted.");
  await upd.getByRole("button", { name: "Add update" }).click();
  await expect(tech.getByText("Ballast ordered, temporary lamp fitted.").first()).toBeVisible();
  expect(await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) } })).toMatchObject({ status: "IN_PROGRESS" });
});

test("S16 · completion needs evidence: an after photo and a root cause are recorded", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Cold room door seal torn");
  await workToCompletion(p, url);
  const c = await db.completion.findFirstOrThrow({ where: { jobId: jobIdOf(url) } });
  expect(c).toMatchObject({ workPerformed: "Repaired and tested.", rootCauses: ["WEAR_AND_TEAR"] });
  expect(await db.attachment.count({ where: { jobId: jobIdOf(url), kind: "AFTER" } })).toBe(1);
});

test("S17 · verification and closure: the reporter confirms it is fixed and the manager closes it", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Staff kitchen tap dripping");
  await workToCompletion(p, url);
  await confirmAndClose(p);
  const job = await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) }, include: { completions: { include: { decision: true } } } });
  expect(job.closedAt).not.toBeNull();
  expect(job.completions[0]!.decision?.outcome).toBe("APPROVED");
});

test("S18 · reopening a closed job needs a reason and keeps the closure record; a repeat fault links to it", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Hand basin blocked");
  await workToCompletion(p, url);
  await confirmAndClose(p);
  await p.getByTestId("report-repeat").click();
  await expect(p.getByTestId("repeat-note")).toContainText("Repeat fault");
  await f(p, "description").fill("Water backing up again.");
  await next(p); await next(p); await next(p); await next(p);
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p.getByTestId("repeat-of")).toBeVisible();
  await gotoReady(p, url);
  const r = await openPanel(p, "Reopen job");
  await r.locator('[name="reason"]').fill("Blocked again two days later");
  await r.getByRole("button", { name: "Reopen job" }).click();
  await expect(p.getByText("Reopened ×1")).toBeVisible();
  await expect(p.getByTestId("timeline")).toContainText("Blocked again two days later");
  expect(await db.completion.count({ where: { jobId: jobIdOf(url) } })).toBe(1); // the original completion is kept
  expect(await db.activityEvent.count({ where: { jobId: jobIdOf(url), type: "job.closed" } })).toBe(1);
});

test("S19 · cross-customer isolation: another company cannot open jobs, documents, files, photos or QR signs", async ({ browser }) => {
  const a = await company(browser);
  const url = await logRequest(a.p, "Secret job at company A", async (q) => { await q.locator("#files").setInputFiles(PHOTO).catch(() => undefined); });
  const jobId = jobIdOf(url);
  const file = await db.attachment.findFirst({ where: { jobId } });
  const ownerA = await db.user.findUniqueOrThrow({ where: { email: a.email } });
  const b = await company(browser);
  for (const path of [`/jobs/${jobId}`, `/jobs/${jobId}/card`, `/jobs/${jobId}/report`]) expect((await b.p.goto(path))?.status(), path).toBe(404);
  for (const path of [`/api/jobs/${jobId}/documents/card`, `/api/jobs/${jobId}/documents/history`, `/api/avatar/${ownerA.id}`, `/api/sites/${a.sitePath.split("/").pop()}/signs`, ...(file ? [`/api/files/${file.id}`] : [])])
    expect([403, 404], path).toContain((await b.p.request.get(path)).status());
  await gotoReady(b.p, "/jobs");
  await expect(b.p.getByText("Secret job at company A")).toHaveCount(0);
});

test("S20 · full maintenance lifecycle: report with photo → assess → assign → work → complete → verify → close → documents", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Packing line conveyor belt slipping", async (q) => { await q.locator("#files").setInputFiles(PHOTO).catch(() => undefined); });
  await workToCompletion(p, url);
  await confirmAndClose(p);
  const id = jobIdOf(url);
  const events = await db.activityEvent.findMany({ where: { jobId: id }, orderBy: { createdAt: "asc" } });
  expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["job.created", "assessment.submitted", "job.assigned", "job.started", "job.completion_submitted", "completion.approved", "job.closed"]));
  const card = await pdfOf(p, `/api/jobs/${id}/documents/card`);
  expect(card.pdf.text).toContain("Closed");
  const done = await pdfOf(p, `/api/jobs/${id}/documents/completion`);
  expect(done.pdf.text).toContain("Final status: Closed");
  const hist = await pdfOf(p, `/api/jobs/${id}/documents/history`);
  expect(hist.pdf.text.toLowerCase()).toContain("activity timeline");
});

// ---------------------------------------------------------------- job documents

test("D1 · the job page offers the job card, PDF download, print and (when done) the completion report", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Extractor fan noisy");
  const docs = p.getByTestId("documents");
  await expect(docs.getByRole("link", { name: "View job card" })).toBeVisible();
  await expect(docs.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/jobs/${jobIdOf(url)}/documents/card?download=1`);
  await expect(docs.getByRole("link", { name: "Print" })).toBeVisible();
  await expect(docs).toContainText("completion report becomes available once the work is completed");
  await docs.getByRole("link", { name: "View job card" }).click();
  await expect(p).toHaveURL(/\/card$/);
  await expect(p.getByTestId("card-controls").getByRole("button", { name: "Print" })).toBeEnabled();
  const src = await p.getByTestId("card-frame").getAttribute("src");
  const framed = await p.request.get(src!);
  expect(framed.headers()["content-type"]).toBe("application/pdf"); // the viewer shows the generated PDF
  expect(framed.headers()["x-frame-options"]).toBe("SAMEORIGIN"); // which may only be framed by ManOp itself
  const a11y = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("iframe").analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
});

test("D2 · downloaded job card: A4, branded, real job data, status and generation time, descriptive file name", async ({ browser }) => {
  const { p, email } = await company(browser);
  const url = await logRequest(p, "Fire door closer broken", undefined, { priority: "HIGH" });
  const job = await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) } });
  const org = await db.organisation.findUniqueOrThrow({ where: { id: await orgOf(email) } });
  const { res, pdf } = await pdfOf(p, `/api/jobs/${job.id}/documents/card?download=1`);
  expect(res.headers()["content-disposition"]).toBe(`attachment; filename="MANOP_JobCard_${job.reference}.pdf"`);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(pdf.pages[0]!.width).toBeCloseTo(595.28, 0);
  expect(pdf.pages[0]!.height).toBeCloseTo(841.89, 0);
  for (const want of ["MAINTENANCE JOB CARD", job.reference, org.name, "Germiston Plant", "Cold Room 2", "Fire door closer broken", "High", "New report", "SAST", "ManOp"])
    expect(pdf.text.toLowerCase()).toContain(want.toLowerCase());
  expect(pdf.text).toMatch(/Generated \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} SAST/);
});

test("D3 · photographs render in the PDF and long reports flow onto more pages with a footer on each", async ({ browser }) => {
  const { p } = await company(browser);
  const long = Array.from({ length: 45 }, (_, i) => `Observation ${i + 1}: the belt slips when the line runs at full speed after the break.`).join(" ");
  await gotoReady(p, "/requests/new");
  await f(p, "title").fill("Belt slipping – detailed report");
  await f(p, "description").fill(long);
  await next(p); await next(p); await next(p);
  await f(p, "files").setInputFiles(PHOTO);
  await next(p);
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  const { pdf } = await pdfOf(p, `/api/jobs/${jobIdOf(p.url())}/documents/card`);
  expect(pdf.pages.length).toBeGreaterThan(1);
  expect(pdf.text).toContain("Observation 45:");
  pdf.pages.forEach((pg, i) => expect(pg.text).toContain(`Page ${i + 1} of ${pdf.pages.length}`));
  expect(pdf.pages.reduce((n, pg) => n + pg.images, 0)).toBeGreaterThanOrEqual(2); // the reported photo + QR code
});

test("D4 · the completion report shows before/after evidence, the verification and the closure", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Basin tap loose");
  await workToCompletion(p, url);
  await confirmAndClose(p);
  await expect(p.getByTestId("documents").getByRole("link", { name: "Download completion report" })).toBeVisible();
  const job = await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) } });
  const { res, pdf } = await pdfOf(p, `/api/jobs/${job.id}/documents/completion?download=1`);
  expect(res.headers()["content-disposition"]).toContain(`MANOP_CompletionReport_${job.reference}.pdf`);
  for (const want of ["COMPLETED JOB REPORT", "Final status: Closed", "Repaired and tested.", "Wear and tear", "Confirmed fixed by"]) expect(pdf.text).toContain(want);
  expect(pdf.pages.reduce((n, pg) => n + pg.images, 0)).toBeGreaterThanOrEqual(2); // after photo + QR
});

test("D5 · documents respect permissions: signed-out 401, reporters get no history, other companies 404", async ({ browser }) => {
  const { p } = await company(browser);
  const reporterEmail = `rep-${uid()}@e2e.example`;
  const reporter = await acceptInvite(browser, await invite(p, reporterEmail, "Rita Reporter", ["REQUESTER"]));
  const url = await logRequest(reporter, "Window latch broken");
  const id = jobIdOf(url);
  expect((await reporter.request.get(`/api/jobs/${id}/documents/card`)).status()).toBe(200);
  expect((await reporter.request.get(`/api/jobs/${id}/documents/history`)).status()).toBe(403);
  expect((await reporter.request.get(`/api/jobs/${id}/documents/completion`)).status()).toBe(409); // not completed yet
  const anon = await newPage(browser);
  expect((await anon.request.get(`/api/jobs/${id}/documents/card`)).status()).toBe(401);
  const other = await company(browser);
  expect((await other.p.request.get(`/api/jobs/${id}/documents/card`)).status()).toBe(404);
  expect((await p.request.get(`/api/jobs/${id}/documents/history`)).status()).toBe(200);
});

test("D6 · the QR code on a printed card opens the digital record only after signing in", async ({ browser }) => {
  const { p, email } = await company(browser);
  const url = await logRequest(p, "Dock leveller stuck");
  const { pdf } = await pdfOf(p, `/api/jobs/${jobIdOf(url)}/documents/card`);
  const target = pdf.pages[0]!.links[0]!;
  expect(new URL(target).pathname).toBe(url);
  const stranger = await newPage(browser);
  await gotoReady(stranger, new URL(target).pathname);
  await expect(stranger).toHaveURL(/\/login\?next=/);
  await f(stranger, "email").fill(email);
  await f(stranger, "password").fill(PASSWORD);
  await stranger.getByRole("button", { name: "Sign in" }).click();
  await expect(stranger).toHaveURL(new RegExp(`${url}$`));
});

test("D7 · on a phone the job card page offers open and download (no tiny embedded viewer) and fits the screen", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Gate motor slow");
  const phone = await newPage(browser, { mobile: true, storageState: await p.context().storageState() });
  await gotoReady(phone, `${url}/card`);
  await expect(phone.getByRole("link", { name: "Open in a new tab" })).toBeVisible();
  await expect(phone.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await expect(phone.getByTestId("card-frame")).toBeHidden();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------- demo

test("V1 · demo: view as a sample technician and approver, then return to yourself", async ({ browser }) => {
  const p = await newPage(browser);
  const { register } = await import("./helpers");
  await register(p, { email: `demo-${uid()}@e2e.example`, company: `Demo View ${uid()}` });
  await p.getByRole("button", { name: "Explore a demo workspace" }).click();
  await expect(p.getByTestId("demo-bar")).toBeVisible({ timeout: 60_000 });
  await f(p, "personaId").selectOption({ label: "Maintenance technician – Jabu Mokoena" });
  await p.getByRole("button", { name: "View as" }).click();
  await expect(p.getByTestId("viewing-as")).toContainText("Jabu Mokoena");
  await gotoReady(p, "/my-jobs");
  await expect(p.getByText("Roller door at packing hall sticking").filter({ visible: true }).first()).toBeVisible();
  await f(p, "personaId").selectOption({ label: "Finance manager – Lerato Botha" });
  await p.getByRole("button", { name: "View as" }).click();
  await expect(p.getByTestId("needs-approval")).toContainText("Packing line 2 gearbox grinding");
  await f(p, "personaId").selectOption({ label: "Myself" });
  await p.getByRole("button", { name: "View as" }).click();
  await expect(p.getByTestId("viewing-as")).toHaveCount(0);
});

// ---------------------------------------------------------------- ManOp: sandbox, tour, one-person jobs

test("X1 · anyone opens a private sandbox from the home page, takes the guided tour and ends on How it works", async ({ browser }) => {
  const p = await newPage(browser);
  await gotoReady(p, "/");
  await expect(p).toHaveTitle(/ManOp/);
  await p.getByTestId("try-demo").click();
  await expect(p).toHaveURL(/\/demo$/);
  await p.getByRole("button", { name: "Open my sandbox" }).click();
  await expect(p).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  await expect(p.getByTestId("demo-bar")).toContainText("Your sandbox");
  const tour = p.getByTestId("tour");
  await expect(tour).toContainText("Welcome to ManOp");
  const titles: string[] = [];
  for (let n = 0; n < 12; n++) {
    titles.push((await tour.locator("h2").textContent())!);
    await tour.getByTestId("tour-next").click();
    await p.waitForLoadState("networkidle");
    await expect(tour.getByRole("dialog")).toBeVisible();
  }
  expect(titles).toEqual(expect.arrayContaining(["Your control room", "Open now and History", "What happens next", "The job card", "Sites, areas and QR codes", "Your team and rules"]));
  await expect(p).toHaveURL(/how-it-works/);
  await expect(tour).toContainText("Two ways a job runs");
  await tour.getByTestId("tour-next").click(); // Finish
  await expect(tour).toHaveCount(0);
  await expect(p.getByTestId("flow-managed")).toBeVisible();
  await expect(p.getByTestId("flow-self")).toBeVisible();
  // The sandbox is private to this visitor and sends nothing.
  await gotoReady(p, "/jobs");
  await expect(p.getByText("Workshop air line hissing at lathe drop").filter({ visible: true }).first()).toBeVisible();
});

test("X2 · one-person job in the app: 'I'll fix it myself' → in progress at once → complete → manager signs off → closed", async ({ browser }) => {
  const { p } = await company(browser);
  await gotoReady(p, "/requests/new");
  await f(p, "title").fill("Office door closer loose");
  await f(p, "description").fill("Door slams; closer arm screws loose.");
  await next(p); await next(p); await next(p); await next(p);
  await expect(p.getByTestId("who-fixes")).toBeVisible();
  await p.getByTestId("who-fixes").getByText("I'll fix it myself").click();
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  await expect(p.getByText("One-person job").first()).toBeVisible();
  await expect(status(p)).toHaveText("In progress");
  await expect(p.getByTestId("next-action")).toContainText("one-person job");
  const done = await openPanel(p, "Work finished – submit evidence");
  await done.locator('[name="workPerformed"]').fill("Re-fixed the closer arm and adjusted the speed.");
  await next(done);
  await done.locator('[name="after"]').setInputFiles(PHOTO);
  await next(done);
  await done.getByTestId("root-causes").getByLabel("Wear and tear", { exact: true }).check();
  await next(done);
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(status(p)).toHaveText("Awaiting confirmation");
  await expect(p.getByTestId("next-action")).toContainText("Sign off the one-person job");
  await gotoReady(p, "/dashboard");
  await expect(p.locator("a.card", { hasText: "One-person jobs to sign off" })).toContainText("1");
  await p.locator("a.card", { hasText: "One-person jobs to sign off" }).click();
  await p.getByText("Office door closer loose").filter({ visible: true }).first().click();
  await (await openPanel(p, "Confirm fixed, sign off and close")).getByRole("button", { name: "Sign off and close" }).click();
  await expect(status(p)).toHaveText("Closed");
});

test("X3 · without manager sign-off a one-person job closes on completion; a manager can take a report as a one-person job", async ({ browser }) => {
  const { p } = await company(browser);
  await gotoReady(p, "/settings");
  await p.getByTestId("self-job-settings").getByLabel(/signs off one-person jobs/).uncheck();
  await p.getByRole("button", { name: "Save company settings" }).click();
  await expect(p.getByText("Company settings saved.")).toBeVisible();
  const url = await logRequest(p, "Canteen light flickering");
  const take = await openPanel(p, "I'll fix it myself (one-person job)");
  await take.getByRole("button", { name: "Take it and start now" }).click();
  await expect(status(p)).toHaveText("In progress");
  const done = await openPanel(p, "Work finished – submit evidence");
  await done.locator('[name="workPerformed"]').fill("Replaced the starter.");
  await next(done);
  await done.locator('[name="after"]').setInputFiles(PHOTO);
  await next(done);
  await done.getByTestId("root-causes").getByLabel("Wear and tear", { exact: true }).check();
  await next(done);
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(status(p)).toHaveText("Closed");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobIdOf(url) } });
  expect(job).toMatchObject({ mode: "SELF", status: "CLOSED" });
  const { pdf } = await pdfOf(p, `/api/jobs/${job.id}/documents/card`);
  expect(pdf.text).toContain("one-person job");
});

test("X4 · How it works is public, accessible and explains both workflows", async ({ browser }) => {
  const p = await newPage(browser);
  await gotoReady(p, "/how-it-works");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("How ManOp works");
  await expect(p.getByTestId("flow-managed")).toContainText("Assigned");
  await expect(p.getByTestId("flow-self")).toContainText("I’ll fix it myself");
  const a11y = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  const phone = await newPage(browser, { mobile: true });
  await gotoReady(phone, "/demo");
  await expect(phone.getByRole("button", { name: "Open my sandbox" })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
