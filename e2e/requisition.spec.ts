import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { card, choosePriority, company, db, f, gotoReady, logRequest, newPage, next, openPanel, sign, status, uid } from "./helpers";

test.afterAll(async () => { await db.$disconnect(); });

const PHOTO = "public/icon-192.png";

/** The company (organisation) a test account owns – data is looked up per company, never by title alone. */
const orgOf = async (email: string) => (await db.membership.findFirstOrThrow({ where: { user: { email } }, orderBy: { createdAt: "asc" } })).orgId;

/** Requisition settings card in Settings. */
async function requisitionSettings(p: Page, o: { prefix?: string; next?: string; signatures?: boolean }) {
  await gotoReady(p, "/settings");
  const c = card(p, "Maintenance work requisition");
  if (o.prefix !== undefined) await c.locator('[name="referencePrefix"]').fill(o.prefix);
  if (o.next !== undefined) await c.locator('[name="nextNumber"]').fill(o.next);
  if (o.signatures !== undefined) await c.locator('[name="requireSignatures"]').setChecked(o.signatures);
  await c.getByRole("button", { name: "Save requisition settings" }).click();
  return c;
}

/** The owner works a reported fault through to "work completed" in the app (assess → in-house → assign self → start → finish). */
async function ownerCompletes(p: Page, jobUrl: string, o: { causes?: string[]; tools?: "Yes" | "No"; sign?: boolean } = {}) {
  await gotoReady(p, jobUrl);
  const a = await openPanel(p, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Checked on site.");
  await a.locator('[name="quoteRequired"]').selectOption("no");
  if (o.sign) await sign(a);
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status(p)).toHaveText("Assessed – decide how to fix");
  const ih = await openPanel(p, "Fix it in-house");
  await ih.getByRole("button", { name: "Give to the in-house team" }).click();
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
  for (const c of o.causes ?? ["Wear and tear"]) await done.getByTestId("root-causes").getByLabel(c, { exact: true }).check();
  if (o.tools) await done.getByTestId("tools-check").getByLabel(o.tools, { exact: true }).check();
  await next(done);
  if (o.sign) await sign(done);
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(status(p)).toHaveText("Awaiting confirmation");
}

/** Reporter = owner here, so the owner confirms and closes. */
async function confirmAndClose(p: Page, o: { sign?: boolean } = {}) {
  const yes = await openPanel(p, "Is it fixed?");
  await yes.locator('[name="outcome"]').selectOption("APPROVED");
  if (o.sign) await sign(yes);
  await yes.getByRole("button", { name: "Send my answer" }).click();
  await expect(status(p)).toHaveText("Confirmed fixed – ready to close");
  const close = await openPanel(p, "Sign off and close");
  if (o.sign) await sign(close);
  await close.getByRole("button", { name: "Sign off and close" }).click();
  await expect(status(p)).toHaveText("Closed");
}

test("R1 · guided report: each step is checked before moving on, Back keeps answers, and Edit jumps back from the review", async ({ browser }) => {
  const { p } = await company(browser);
  await gotoReady(p, "/requests/new");
  await next(p);
  await expect(p.getByTestId("step-label")).toContainText("Step 1 of 5"); // title and description are required
  await f(p, "title").fill("Tap dripping in the staff kitchen");
  await f(p, "description").fill("Hot tap won't close fully.");
  await next(p);
  await expect(p.getByTestId("step-label")).toHaveText("Step 2 of 5 · How urgent is it?");
  await expect(p.locator('[data-testid="priority-choice"] input[value="NORMAL"]')).toBeChecked(); // Medium unless changed
  await choosePriority(p, "HIGH");
  await next(p);
  await expect(p.getByTestId("step-label")).toHaveText("Step 3 of 5 · Where is it?");
  await p.getByRole("button", { name: "← Back" }).click();
  await p.getByRole("button", { name: "← Back" }).click();
  await expect(f(p, "title")).toHaveValue("Tap dripping in the staff kitchen");
  await next(p);
  await expect(p.locator('[data-testid="priority-choice"] input[value="HIGH"]')).toBeChecked(); // Back keeps answers
  await next(p); await next(p); await next(p);
  const review = p.getByTestId("review");
  await expect(review).toContainText("High – affecting work");
  await expect(review).toContainText("Germiston Plant");
  await expect(review.getByText("This is an emergency")).toHaveCount(0); // unticked boxes are left out
  const a11y = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]); // the review (incl. "Nothing added" sections) is valid
  await review.getByRole("button", { name: "Edit What is wrong?" }).click();
  await f(p, "title").fill("Hot tap dripping in the staff kitchen");
  await next(p); await next(p); await next(p); await next(p);
  await expect(p.getByTestId("review")).toContainText("Hot tap dripping in the staff kitchen");
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Hot tap dripping in the staff kitchen");
});

test("R2 · pressing Enter in a one-line field moves to the next step instead of sending the report early", async ({ browser }) => {
  const { p } = await company(browser);
  await gotoReady(p, "/requests/new");
  await f(p, "description").fill("Something is wrong.");
  await f(p, "title").fill("Fire door not closing");
  await f(p, "title").press("Enter");
  await expect(p.getByTestId("step-label")).toContainText("Step 2 of 5");
  await expect(p).toHaveURL(/requests\/new/);
  expect(await db.job.count({ where: { title: "Fire door not closing" } })).toBe(0);
});

test("R3 · requisition numbering continues a paper book; the number can never go backwards", async ({ browser }) => {
  const { p } = await company(browser);
  const c = await requisitionSettings(p, { prefix: "", next: "12600" });
  await expect(p.getByText("Requisition settings saved.")).toBeVisible();
  await gotoReady(p, "/settings");
  await expect(card(p, "Maintenance work requisition")).toContainText("Next requisition: 12600");
  const url = await logRequest(p, "Canteen window cracked");
  await expect(p.getByText(/^12600 ·/).first()).toBeVisible();
  await requisitionSettings(p, { next: "100" });
  await expect(c.locator("p[role=alert]")).toContainText("higher than the last one used (12600)");
  await gotoReady(p, `${url}/report`);
  await expect(p.getByTestId("requisition-number")).toHaveText("12600");
});

test("R4 · signatures are optional by default; the form shows empty signature lines until someone signs", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Lift button stuck");
  expect(await db.jobSignature.count({ where: { job: { id: url.split("/").pop()! } } })).toBe(0);
  await gotoReady(p, `${url}/report`);
  await expect(p.getByTestId("sig-REPORTED").locator("img")).toHaveCount(0);
  await expect(p.getByTestId("submitted-by")).toContainText("Olive Owner");
  await expect(p.getByTestId("date-reported")).toContainText(new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }));
});

test("R5 · when signatures are required, the review step won't send without one, and Clear really clears it", async ({ browser }) => {
  const { p } = await company(browser);
  await requisitionSettings(p, { signatures: true });
  await expect(p.getByText("Requisition settings saved.")).toBeVisible();
  await gotoReady(p, "/requests/new");
  await f(p, "title").fill("Extractor fan noisy");
  await f(p, "description").fill("Grinding noise.");
  await next(p); await next(p); await next(p); await next(p);
  await expect(p.getByText("Submitted by – your signature")).toBeVisible();
  await expect(p.getByText("(optional)")).toHaveCount(0); // marked as required
  await sign(p);
  await p.getByRole("button", { name: "Clear" }).click();
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p.locator("p[role=alert]")).toContainText("sign the report");
  await sign(p);
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  await expect(p.getByTestId("requisition-stages").locator('[data-stage="reported"]')).toContainText("signed");
});

test("R6 · food-handling areas ask the tools / clean-area question, and the form shows the Y/N answer", async ({ browser }) => {
  const { p, sitePath } = await company(browser);
  await gotoReady(p, sitePath);
  const row = p.getByTestId("locations").locator("li", { hasText: "Cold Room 2" });
  await row.getByRole("button", { name: "Mark as food area" }).click();
  await expect(p.getByTestId("locations").locator("li", { hasText: "Cold Room 2" })).toContainText("Food-handling area");
  const url = await logRequest(p, "Fryer not heating");
  await gotoReady(p, url);
  await ownerCompletes(p, url, { causes: ["Breakdown"], tools: "Yes" });
  await gotoReady(p, `${url}/report`);
  await expect(p.getByTestId("tools-check-answer")).toContainText("Y/N: Y");
});

test("R7 · the Projects box: planned work is tagged on the job and ticked on the requisition", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Repaint loading bay lines", async (q) => { await q.getByLabel("This is a project (planned work, not a breakdown)").check(); });
  await expect(p.locator(".badge", { hasText: "Project" })).toBeVisible();
  await gotoReady(p, `${url}/report`);
  await expect(p.getByTestId("requisition").locator('[data-checked="true"]', { hasText: "Projects" })).toHaveCount(1);
});

test("R8 · the job page tracks the requisition section by section and highlights what is next", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Door closer broken");
  const stages = p.getByTestId("requisition-stages");
  await expect(stages.locator('[data-stage="reported"]')).toHaveAttribute("data-done", "true");
  await expect(stages.locator('[data-stage="received"]')).toContainText("Next");
  await ownerCompletes(p, url);
  await expect(stages.locator('[data-stage="started"]')).toHaveAttribute("data-done", "true");
  await expect(stages.locator('[data-stage="completed"]')).toHaveAttribute("data-done", "true");
  await expect(stages.locator('[data-stage="originator"]')).toContainText("Next");
  await confirmAndClose(p);
  await expect(stages.locator('[data-done="false"]')).toHaveCount(0);
});

test("R9 · the printed requisition fits on one A4 page", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Print layout check");
  await gotoReady(p, `${url}/report`);
  await p.setViewportSize({ width: 794, height: 1123 }); // A4 at 96 dpi
  await p.emulateMedia({ media: "print" });
  const box = (await p.getByTestId("requisition").boundingBox())!;
  expect(box.height).toBeLessThan(1123 - 2 * 38); // inside default print margins
  await expect(p.getByRole("button", { name: "Print / save as PDF" })).toBeHidden(); // buttons are not printed
});

test("R10 · area report: most-affected areas link through to the area's history, root causes and a pre-filled report", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Cold room light out");
  await ownerCompletes(p, url, { causes: ["Human error", "Other"] });
  await confirmAndClose(p);
  await gotoReady(p, "/reports");
  await p.getByTestId("affected-areas").getByRole("link", { name: "Germiston Plant — Cold Room 2" }).click();
  await expect(p).toHaveURL(/\/areas\/[0-9a-f-]{36}$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Cold Room 2");
  await expect(p.getByTestId("area-reported")).toContainText("1");
  await expect(p.getByTestId("area-history")).toContainText("Cold room light out");
  await expect(p.getByTestId("area-history")).toContainText("Human error, Other");
  await expect(p.getByTestId("area-root-causes")).toContainText("Human error");
  await p.getByRole("link", { name: "+ Report a fault here" }).click();
  await next(p); await next(p);
  await expect(f(p, "locationId")).toHaveValue(/[0-9a-f-]{36}/);
  expect(await f(p, "locationId").locator("option:checked").textContent()).toBe("Cold Room 2");
});

test("R11 · area CSV download only contains that area, with root causes and the Projects column", async ({ browser }) => {
  const { p, sitePath, email } = await company(browser);
  await gotoReady(p, sitePath);
  await p.getByPlaceholder("Add a location, e.g. Plant room").fill("Packing Hall");
  await p.getByRole("button", { name: "Add location" }).click();
  await expect(p.getByText("Location added.")).toBeVisible();
  const cold = await logRequest(p, "Cold room fault A");
  await logRequest(p, "Packing hall fault B", undefined, { location: "Packing Hall" });
  await ownerCompletes(p, cold, { causes: ["Operator"] });
  const loc = await db.location.findFirstOrThrow({ where: { name: "Cold Room 2", orgId: await orgOf(email) } });
  await gotoReady(p, `/areas/${loc.id}`);
  const href = await p.getByRole("link", { name: "Download (CSV)" }).getAttribute("href");
  const csv = await (await p.request.get(href!)).text();
  expect(csv).toContain('"Project","Root causes","Root cause notes"');
  expect(csv).toContain("Cold room fault A");
  expect(csv).toContain('"Operator"');
  expect(csv).not.toContain("Packing hall fault B");
});

test("R12 · Insights can be narrowed to one area of a site", async ({ browser }) => {
  const { p, sitePath } = await company(browser);
  await gotoReady(p, sitePath);
  await p.getByPlaceholder("Add a location, e.g. Plant room").fill("Main Kitchen");
  await p.getByRole("button", { name: "Add location" }).click();
  await expect(p.getByText("Location added.")).toBeVisible();
  await logRequest(p, "Fault one");
  await logRequest(p, "Fault two");
  await gotoReady(p, "/reports");
  const faults = p.locator(".card", { hasText: "Faults reported" }).first();
  await expect(faults).toContainText("2");
  await f(p, "locationId").selectOption({ label: "Main Kitchen" });
  await p.getByRole("button", { name: "Apply" }).click();
  await expect(p).toHaveURL(/locationId=/);
  await expect(p.locator(".card", { hasText: "Faults reported" }).first()).toContainText("0");
  await expect(p.getByRole("link", { name: "Area report" })).toBeVisible();
});

test("R13 · no-account QR report: the details step is checked, the review shows it, and the requisition records the reporter", async ({ browser }) => {
  const { p, sitePath, email } = await company(browser);
  await gotoReady(p, "/settings");
  await f(p, "publicReportingEnabled").check();
  await p.getByRole("button", { name: "Save company settings" }).click();
  await expect(p.getByText("Company settings saved.")).toBeVisible();
  await gotoReady(p, sitePath);
  const link = new URL(await p.getByTestId("site-report-link").inputValue()).pathname;
  const anon = await newPage(browser, { mobile: true });
  await gotoReady(anon, link);
  await f(anon, "description").fill("Broken window in canteen, glass on the floor.");
  await next(anon); await next(anon); await next(anon); await next(anon);
  await f(anon, "reporterName").fill("Grace Visitor");
  await next(anon);
  await expect(anon.getByTestId("step-label")).toContainText("Step 5 of 6"); // phone number is required
  await f(anon, "reporterPhone").fill("082 123 4567");
  await next(anon);
  await expect(anon.getByTestId("review")).toContainText("Grace Visitor");
  await expect(anon.getByTestId("review")).toContainText("082 123 4567");
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.getByTestId("report-done")).toContainText("Thank you!");
  const job = await db.job.findFirstOrThrow({ where: { title: { startsWith: "Broken window in canteen" }, orgId: await orgOf(email) } });
  await gotoReady(p, `/jobs/${job.id}/report`);
  await expect(p.getByTestId("submitted-by")).toContainText("Grace Visitor (082 123 4567) – via QR / site link");
});

test("R14 · demo workspace: a fully signed requisition, history per area, and numbers continuing from 12600", async ({ browser }) => {
  const p = await newPage(browser);
  const { register } = await import("./helpers");
  await register(p, { email: `demo-${uid()}@e2e.example`, company: `Demo Check ${uid()}` });
  await p.getByRole("button", { name: "Explore a demo workspace" }).click();
  await expect(p.getByText("Demo workspace.")).toBeVisible({ timeout: 60_000 });
  await gotoReady(p, "/jobs?tab=history"); // finished jobs live under History
  await p.getByText("Staff kitchen extractor fan very noisy").filter({ visible: true }).first().click();
  await p.getByRole("link", { name: "Requisition form" }).click();
  await expect(p.getByTestId("requisition-number")).toHaveText(/^126\d\d$/);
  for (const step of ["REPORTED", "RECEIVED", "COMPLETED", "ORIGINATOR", "MANAGER"]) await expect(p.getByTestId(`sig-${step}`).locator("img")).toBeVisible();
  await expect(p.getByTestId("tools-check-answer")).toContainText("Y");
  await gotoReady(p, "/reports?from=2000-01-01");
  await expect(p.getByTestId("affected-areas")).toContainText("Cold Room 2");
  await p.getByTestId("affected-areas").getByRole("link", { name: /Cold Room 2/ }).click();
  await expect(p.getByTestId("area-history").locator("tbody tr")).toHaveCount(4);
});

test("R15 · technician on a phone: the guided completion form fits the screen and shows the review before signing", async ({ browser }) => {
  const { p } = await company(browser);
  const url = await logRequest(p, "Phone completion check");
  const phone = await newPage(browser, { mobile: true, storageState: await p.context().storageState() });
  await gotoReady(phone, url);
  const a = await openPanel(phone, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Loose hinge.");
  await a.locator('[name="quoteRequired"]').selectOption("no");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await (await openPanel(phone, "Fix it in-house")).getByRole("button", { name: "Give to the in-house team" }).click();
  const as = await openPanel(phone, "Assign a technician");
  await as.locator('[name="leadTechnicianId"]').selectOption({ index: 1 });
  await as.getByRole("button", { name: "Assign job" }).click();
  await phone.getByRole("button", { name: "Start work" }).click();
  const done = await openPanel(phone, "Work finished – submit evidence");
  await done.locator('[name="workPerformed"]').fill("Tightened the hinge.");
  await next(done);
  await done.locator('[name="after"]').setInputFiles(PHOTO);
  await next(done);
  await done.getByTestId("root-causes").getByLabel("Maintenance", { exact: true }).check();
  await next(done);
  await expect(done.getByTestId("review")).toContainText("Tightened the hinge.");
  await expect(done.getByTestId("review")).toContainText("Maintenance");
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - screen.width)).toBeLessThanOrEqual(0);
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(status(phone)).toHaveText("Awaiting confirmation");
});

test("R16 · anyone with a phone: the QR report is simple, big and steady – no zoom-in on tap, nothing slides sideways, clear thank-you", async ({ browser }) => {
  const { p, sitePath, email } = await company(browser);
  await gotoReady(p, "/settings");
  await f(p, "publicReportingEnabled").check();
  await p.getByRole("button", { name: "Save company settings" }).click();
  await expect(p.getByText("Company settings saved.")).toBeVisible();
  await gotoReady(p, sitePath);
  const link = new URL(await p.getByTestId("site-report-link").inputValue()).pathname;
  const loc = await db.location.findFirstOrThrow({ where: { name: "Cold Room 2", orgId: await orgOf(email) } });
  const { devices } = await import("@playwright/test");
  const phone = await (await browser.newContext({ ...devices["iPhone 13"], extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` } })).newPage();
  await gotoReady(phone, `${link}?l=${loc.id}`);

  // The page never blocks pinch-zoom (people with poor eyesight need it), but nothing makes it zoom on its own.
  const vp = await phone.locator('meta[name="viewport"]').getAttribute("content");
  expect(vp).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
  const steady = async (label: string) => {
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label}: sideways scroll`).toBeLessThanOrEqual(0);
    const small = await phone.evaluate(() => [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=radio]):not([type=file]), select, textarea")]
      .filter((e) => e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.getAttribute("name")));
    expect(small, `${label}: fields under 16px make iPhones zoom in`).toEqual([]);
    const tiny = await phone.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, .choice, .btn")]
      .filter((e) => e.offsetParent !== null && !e.classList.contains("link") && e.getBoundingClientRect().height < 44).map((e) => e.textContent?.trim()));
    expect(tiny, `${label}: tap targets under 44px`).toEqual([]);
    const a11y = await new AxeBuilder({ page: phone }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(a11y.violations.map((v) => v.id), `${label}: accessibility`).toEqual([]);
  };

  await expect(phone.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await expect(phone.getByText("If someone is hurt or in danger, call your supervisor first.")).toBeVisible();
  await steady("what's wrong");
  await next(phone);
  await expect(phone.getByTestId("step-label")).toContainText("Step 1 of 6"); // a description is needed
  await phone.getByText("Leaking", { exact: true }).click();
  await f(phone, "description").fill("Water dripping from the ceiling by the door");
  await next(phone);
  await expect(phone.getByTestId("step-label")).toHaveText("Step 2 of 6 · How urgent is it?");
  await steady("how urgent");
  await phone.getByText("Stopped or unsafe").click(); // big cards: tap anywhere on "Critical"
  await next(phone);
  await expect(phone.getByTestId("place-confirm")).toContainText("Cold Room 2"); // from the QR code, no dropdown to work out
  await steady("where");
  await next(phone);
  await steady("photo");
  await phone.locator('input[name="photos"]').setInputFiles(PHOTO);
  await expect(phone.getByText("1 photo added – tap to change")).toBeVisible();
  await next(phone);
  await steady("details");
  await f(phone, "reporterName").fill("Grace Visitor");
  await f(phone, "reporterPhone").fill("072 555 0101");
  await next(phone);
  const review = phone.getByTestId("review");
  for (const t of ["Leaking", "Water dripping", "Critical – stopped or unsafe", "Cold Room 2", "icon-192.png", "Grace Visitor"]) await expect(review).toContainText(t);
  await steady("check and send");
  await phone.getByRole("button", { name: "Send report" }).click();
  await expect(phone.getByTestId("report-done")).toContainText("Thank you!");
  await expect(phone.getByTestId("report-number")).toHaveText(/^REQ-\d{5}$/);
  await steady("thank you");

  // What maintenance receives: a clear title, the place, and the photo.
  const ref = await phone.getByTestId("report-number").textContent();
  const job = await db.job.findFirstOrThrow({ where: { reference: ref!, orgId: await orgOf(email) }, include: { attachments: true } });
  expect(job.title).toBe("Leaking: Water dripping from the ceiling by the door");
  expect(job.locationId).toBe(loc.id);
  expect(job.priority).toBe("CRITICAL");
  expect(job.attachments.filter((a) => a.kind === "REQUEST" && a.mimeType.startsWith("image/"))).toHaveLength(1);
  await phone.getByRole("button", { name: "Report another problem" }).click();
  await expect(phone.getByTestId("step-label")).toContainText("Step 1 of 6");
  await expect(f(phone, "description")).toHaveValue("");
});
