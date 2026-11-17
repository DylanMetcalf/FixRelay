import { type Browser, expect, type Page, test } from "@playwright/test";
import { verifyEmail } from "./helpers";

const uid = Math.random().toString(36).slice(2, 8);
const PASSWORD = "correct-horse-battery";
const PHOTO = "public/icon-192.png";
const owner = { email: `owner-${uid}@e2e.example`, company: `E2E Maintenance ${uid}` };
const tech = { email: `tech-${uid}@e2e.example`, name: "Tina Tech" };

const f = (p: Page, name: string) => p.locator(`:is(input,select,textarea)[name="${name}"]`);
const card = (p: Page, title: string) => p.locator("section.card", { has: p.getByRole("heading", { name: title, exact: true }) });
const panel = (p: Page, label: string) => p.locator("details.action", { has: p.locator("summary", { hasText: label }) });
async function openPanel(p: Page, label: string) {
  const d = panel(p, label);
  if (!(await d.getAttribute("open") !== null)) await d.locator("summary").click();
  return d;
}
const status = (p: Page) => p.locator(".badge").first();

async function register(p: Page, who: { email: string; company: string }) {
  await p.goto("/register");
  await p.waitForLoadState("networkidle");
  await f(p, "companyName").fill(who.company);
  await f(p, "name").fill("Olive Owner");
  await f(p, "email").fill(who.email);
  await f(p, "password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await expect(p).toHaveURL(/dashboard/);
}
async function login(p: Page, email: string) {
  await p.goto("/login");
  await p.waitForLoadState("networkidle");
  await f(p, "email").fill(email);
  await f(p, "password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p).not.toHaveURL(/login/);
}
async function shareLink(scope: ReturnType<Page["locator"]>) {
  const v = await scope.getByTestId("share-link").locator("input").inputValue();
  return new URL(v).pathname;
}
const fresh = async (b: Browser, mobile = false) => (await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : {})).newPage();

test.describe.configure({ mode: "serial" });
let jobUrl = "";
let fileUrl = "";

test("primary journey: register → request → assess → quote → approve → assign → complete → sign-off → close → history", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());

  // 1. Register a maintenance company; onboarding checklist is shown.
  await register(page, owner);
  await expect(page.getByText("Getting started")).toBeVisible();
  await verifyEmail(page, owner.email); // required before inviting people or sending customer links

  // Company settings: VAT registered + brand colour.
  await page.goto("/settings");
  await f(page, "vatRegistered").check();
  await f(page, "vatNumber").fill("4123456789");
  await f(page, "phone").fill("011 555 0100");
  await f(page, "brandColour").fill("#b91c1c");
  await page.getByRole("button", { name: "Save company settings" }).click();
  await expect(page.getByText("Company settings saved.")).toBeVisible();

  // Invite a technician, who accepts in their own browser.
  const invite = card(page, "Invite a team member");
  await invite.locator('[name="email"]').fill(tech.email);
  await invite.locator('[name="name"]').fill(tech.name);
  await invite.getByRole("button", { name: "Send invitation" }).click();
  const invitePath = await shareLink(invite);
  const techPage = await fresh(browser, true);
  techPage.on("dialog", (d) => d.accept());
  await techPage.goto(invitePath);
  await f(techPage, "password").fill(PASSWORD);
  await techPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(techPage).toHaveURL(/dashboard/);

  // 2–3. Add a client and a site.
  await page.goto("/customers");
  const add = card(page, "Add a customer");
  await add.locator('[name="name"]').fill("Karoo Cold Storage");
  await add.locator('[name="contactName"]').fill("Carl Customer");
  await add.locator('[name="email"]').fill("carl@karoo.example");
  await add.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]{36}/);
  const site = await openPanel(page, "Add a site");
  await site.locator('[name="name"]').fill("Germiston Depot");
  await site.getByRole("button", { name: "Add site" }).click();
  await expect(page.getByText("Germiston Depot").first()).toBeVisible();

  // 4. Log a maintenance request with a photo.
  await page.goto("/requests/new");
  await f(page, "title").fill("Compressor tripping on overload");
  await f(page, "description").fill("Trips after 20 minutes of running.");
  await f(page, "priority").selectOption("HIGH");
  await f(page, "files").setInputFiles(PHOTO);
  await page.getByRole("button", { name: "Log request" }).click();
  await expect(page).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  jobUrl = new URL(page.url()).pathname;
  await expect(status(page)).toHaveText("New request");
  await expect(page.getByTestId("next-action")).toContainText("Review and send for assessment");
  fileUrl = (await page.locator('img[src^="/api/files/"]').last().getAttribute("src"))!;

  // 5. Send for assessment; the technician assesses on a phone.
  const req = await openPanel(page, "Send for assessment");
  await req.locator('[name="assessorId"]').selectOption({ label: tech.name });
  await req.getByRole("button", { name: "Send for assessment" }).click();
  await expect(status(page)).toHaveText("Awaiting assessment");

  await techPage.goto("/my-jobs");
  await techPage.getByText("Compressor tripping on overload").filter({ visible: true }).click();
  const assess = await openPanel(techPage, "Record assessment");
  await assess.locator('[name="findings"]').fill("Start capacitor degraded.");
  await assess.locator('[name="quoteRequired"]').selectOption("yes");
  await assess.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status(techPage)).toHaveText("Assessed");
  await expect(techPage.getByText("Quotations")).toHaveCount(0); // technicians never see pricing

  // 6. Generate a quotation with labour + material lines; totals include 15% VAT.
  await page.reload();
  await page.getByRole("button", { name: "Prepare quotation" }).click();
  await expect(page).toHaveURL(/quotes\//);
  await f(page, "scope").fill("Replace start capacitor and test under load.");
  const line = (i: number) => page.getByTestId("quote-line").nth(i);
  await line(0).getByLabel("Description").fill("Technician labour");
  await line(0).getByLabel("Quantity").fill("2.5");
  await line(0).getByLabel("Unit price in rand").fill("650");
  await page.getByRole("button", { name: "+ Add line" }).click();
  await line(1).getByLabel("Type").selectOption("MATERIAL");
  await line(1).getByLabel("Description").fill("Start capacitor");
  await line(1).getByLabel("Unit price in rand").fill("1 234,56");
  await expect(page.getByTestId("quote-totals")).toContainText("R 2 859.56"); // 1625.00 + 1234.56
  await expect(page.getByTestId("quote-totals")).toContainText("R 428.93"); // 15%
  await expect(page.getByTestId("quote-totals")).toContainText("R 3 288.49");
  await page.getByRole("button", { name: "Save and submit for approval" }).click();
  await expect(page.getByTestId("quote-total")).toHaveText("R 3 288.49"); // server-computed

  // 7. Send it to the client via a secure link.
  const send = card(page, "Send to customer");
  await send.getByRole("button", { name: "Create secure review link" }).click();
  const quotePath = await shareLink(send);
  expect(quotePath).toMatch(/^\/q\/[A-Za-z0-9_-]{43}$/);

  // 8. The customer (no account) approves.
  const customer = await fresh(browser, true);
  await customer.goto(quotePath);
  await expect(customer.getByText(owner.company).first()).toBeVisible();
  await expect(customer.getByTestId("quote-total")).toHaveText("R 3 288.49");
  await f(customer, "outcome").selectOption("APPROVED");
  await customer.getByRole("button", { name: "Submit decision" }).click();
  await expect(customer.getByTestId("decision-recorded")).toContainText("approved");
  await customer.reload(); // the link cannot be used twice
  await expect(customer.getByRole("button", { name: "Submit decision" })).toHaveCount(0);

  // 9. Assign the technician.
  await page.goto(jobUrl);
  await expect(status(page)).toHaveText("Approved – awaiting assignment");
  const assign = await openPanel(page, "Assign a technician");
  await assign.locator('[name="leadTechnicianId"]').selectOption({ label: tech.name });
  await assign.locator('[name="instructions"]').fill("Isolate power first.");
  await assign.getByRole("button", { name: "Assign job" }).click();
  await expect(status(page)).toHaveText("Assigned");

  // 10–11. Technician starts, records work, and submits completion with evidence.
  await techPage.goto("/notifications");
  await expect(techPage.getByText(/You have been assigned/)).toBeVisible();
  await techPage.goto(jobUrl);
  await expect(techPage.getByText("Isolate power first.")).toBeVisible();
  await techPage.getByRole("button", { name: "Start work" }).click();
  await expect(status(techPage)).toHaveText("In progress");
  const upd = await openPanel(techPage, "Add update / note");
  await upd.locator('[name="note"]').fill("Old capacitor removed.");
  await upd.locator('[name="labourMinutes"]').fill("90");
  await upd.getByRole("button", { name: "Add update" }).click();
  await expect(techPage.getByText("Old capacitor removed.")).toBeVisible();
  const done = await openPanel(techPage, "Complete work and submit evidence");
  await done.locator('[name="workPerformed"]').fill("Replaced capacitor, ran for one hour.");
  await done.getByRole("button", { name: "Submit for verification" }).click();
  await expect(done.locator("p[role=alert]")).toContainText("after-photo"); // evidence is mandatory
  await done.locator('[name="after"]').setInputFiles(PHOTO);
  await done.getByRole("button", { name: "Submit for verification" }).click();
  await expect(status(techPage)).toHaveText("Awaiting verification");

  // 12. Customer sign-off by secure link with a drawn signature. The manager cannot close before it.
  await page.reload();
  await expect(page.getByRole("button", { name: "Close job" })).toHaveCount(0);
  const vl = await openPanel(page, "Send verification link to customer");
  await vl.getByRole("button", { name: "Create secure link" }).click();
  const verifyPath = await shareLink(vl);
  await customer.goto(verifyPath);
  await expect(customer.getByText("Replaced capacitor, ran for one hour.")).toBeVisible();
  await expect(customer.locator('img[src*="/api/public/files/"]').first()).toBeVisible();
  const pad = customer.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await pad.dispatchEvent("pointerdown", { clientX: box.x + 20, clientY: box.y + 30, pointerId: 1 });
  await pad.dispatchEvent("pointermove", { clientX: box.x + 120, clientY: box.y + 60, pointerId: 1 });
  await pad.dispatchEvent("pointerup", { clientX: box.x + 120, clientY: box.y + 60, pointerId: 1 });
  await f(customer, "outcome").selectOption("APPROVED");
  await customer.getByRole("button", { name: "Submit decision" }).click();
  await expect(customer.getByTestId("decision-recorded")).toContainText("approved");

  // 13. Close the job.
  await page.reload();
  await expect(status(page)).toHaveText("Verified – ready to close");
  await page.getByRole("button", { name: "Close job" }).click();
  await expect(status(page)).toHaveText("Closed");

  // 14. Complete history and the printable report.
  const timeline = page.getByTestId("timeline");
  for (const t of ["Request logged", "Sent for assessment", "Assessment completed", "submitted for approval", "approved by Carl Customer (secure link)",
    "Assigned to Tina Tech", "Work started", "Completion submitted", "Completed work (v1) approved by Carl Customer", "Job closed"]) await expect(timeline).toContainText(t);
  await expect(page.locator('img[alt^="Signature of"]')).toBeVisible();
  await page.getByRole("link", { name: "Job report" }).click();
  await expect(page.getByTestId("report-history")).toContainText("Job closed");
  await expect(page.getByText("R 3 288.49")).toBeVisible();
  await page.goto("/reports");
  await expect(page.locator(".card", { hasText: "Jobs completed" }).first()).toContainText("1");

  // Reopen with a reason.
  await page.goto(jobUrl);
  const re = await openPanel(page, "Reopen job");
  await re.locator('[name="reason"]').fill("Tripped again after two days");
  await re.getByRole("button", { name: "Reopen job" }).click();
  await expect(status(page)).toHaveText("Assigned");
  await expect(page.getByText("Reopened ×1")).toBeVisible();
});

test("rejected quote → revision keeps history; cancelled job; permission failures", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, owner.email);
  await page.goto("/requests/new");
  await f(page, "title").fill("Roller door stuck");
  await f(page, "description").fill("Will not close.");
  await page.getByRole("button", { name: "Log request" }).click();
  await expect(page).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  const url = new URL(page.url()).pathname;
  const assess = await openPanel(page, "Assess it myself now");
  await assess.locator('[name="findings"]').fill("Spring broken.");
  await assess.getByRole("button", { name: "Submit assessment" }).click();
  await page.getByRole("button", { name: "Prepare quotation" }).click();
  await f(page, "scope").fill("Replace spring.");
  await page.getByTestId("quote-line").first().getByLabel("Description").fill("Spring");
  await page.getByTestId("quote-line").first().getByLabel("Unit price in rand").fill("1000");
  await page.getByRole("button", { name: "Save and submit for approval" }).click();
  const send = card(page, "Send to customer");
  await send.getByRole("button", { name: "Create secure review link" }).click();
  const path = await shareLink(send);

  const customer = await fresh(browser);
  await customer.goto(path);
  await f(customer, "outcome").selectOption("REJECTED");
  await customer.getByRole("button", { name: "Submit decision" }).click();
  await expect(customer.locator("p[role=alert]")).toContainText("why you are rejecting");
  await f(customer, "comment").fill("Too expensive");
  await customer.getByRole("button", { name: "Submit decision" }).click();
  await expect(customer.getByTestId("decision-recorded")).toContainText("rejected");

  await page.reload();
  await expect(page.getByText("“Too expensive”")).toBeVisible();
  await page.getByRole("button", { name: "Create revision" }).click();
  await expect(page.getByRole("heading", { name: /v2$/ })).toBeVisible();
  await expect(page.getByTestId("quote-versions")).toContainText("Version 1");
  await expect(page.getByTestId("quote-versions")).toContainText("Rejected");

  await page.goto(url);
  await expect(status(page)).toHaveText("Quote being prepared");
  const cancel = await openPanel(page, "Cancel job");
  await cancel.locator('[name="reason"]').fill("Customer will replace the door");
  await cancel.getByRole("button", { name: "Cancel job" }).click();
  await expect(status(page)).toHaveText("Cancelled");
  await expect(page.getByTestId("actions")).toHaveCount(0);

  // Technician: no settings, no quotes, no customers management, and cannot open a job they are not on.
  const t = await fresh(browser);
  await login(t, tech.email);
  for (const p of ["/settings", "/quotes", "/reports"]) { await t.goto(p); await expect(t).toHaveURL(/forbidden/); }
  expect((await t.goto(url))!.status()).toBe(404);
  await expect(t.getByText("Roller door stuck")).toHaveCount(0); // nothing about the job leaks
  await t.goto("/platform");
  await expect(t).toHaveURL(/forbidden/);

  // Signed-out visitors are sent to sign in; files are not served.
  const anon = await fresh(browser);
  await anon.goto(jobUrl);
  await expect(anon).toHaveURL(/login/);
  expect((await anon.request.get(fileUrl)).status()).toBe(404);
  expect((await anon.request.get("/q/" + "A".repeat(43))).status()).toBe(200);
  await anon.goto("/q/" + "A".repeat(43));
  await expect(anon.getByText("This link is not valid")).toBeVisible();
});

test("a second company cannot reach the first company's jobs or files; PWA manifest is tenant-branded", async ({ page }) => {
  await register(page, { email: `rival-${uid}@e2e.example`, company: `Rival Repairs ${uid}` });
  expect((await page.goto(jobUrl))!.status()).toBe(404);
  expect((await page.request.get(fileUrl)).status()).toBe(404);
  expect((await page.request.get(`${jobUrl}/report`)).status()).toBe(404);
  await page.goto("/jobs");
  await expect(page.getByText("Compressor tripping on overload")).toHaveCount(0);
  const manifest = await (await page.request.get("/api/manifest")).json();
  expect(manifest.name).toContain("Rival Repairs");
  expect(manifest.display).toBe("standalone");
  expect((await page.request.get("/sw.js")).status()).toBe(200);
  const headers = (await page.request.get("/login")).headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
});
