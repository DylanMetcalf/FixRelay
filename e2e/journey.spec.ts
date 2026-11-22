import { expect, test } from "@playwright/test";
import {
  acceptInvite, addContractor, addSite, card, choosePriority, db, f, gotoReady, invite, lastEmail, logRequest, newPage, next, openPanel, pathFrom, register, sign, status, uid, verifyEmail,
} from "./helpers";

const id = uid();
const PHOTO = "public/icon-192.png";
const owner = { email: `owner-${id}@e2e.example`, company: `E2E Foods ${id}` };
const techEmail = `tech-${id}@e2e.example`;
const reporterEmail = `rita-${id}@e2e.example`;
const approverEmail = `fin-${id}@e2e.example`;
const cool = { name: "CoolTech Refrigeration", email: `cooltech-${id}@contractor.example` };
const sparks = { name: "Sparks Electrical", email: `sparks-${id}@contractor.example` };

test.describe.configure({ mode: "serial" });
test.afterAll(async () => { await db.$disconnect(); });

let inHouseJob = "";
let fileUrl = "";
let sitePath = "";
let loserQuoteLink = "";

test("in-house journey: reporter logs a fault on a phone → assess → in-house → assign → work → reporter confirms → close → history", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await register(page, owner);
  await expect(page.getByText("Getting started")).toBeVisible();
  await verifyEmail(page, owner.email);
  sitePath = await addSite(page, "Germiston Plant", ["Cold Room 2", "Packing Hall"]);
  // The paper requisition, made digital: numbers continue the paper book and every line must be signed.
  await gotoReady(page, "/settings");
  const req = card(page, "Maintenance work requisition");
  await req.locator('[name="referencePrefix"]').fill("");
  await req.locator('[name="nextNumber"]').fill("12600");
  await req.locator('[name="requireSignatures"]').check();
  await req.getByRole("button", { name: "Save requisition settings" }).click();
  await expect(page.getByText("Requisition settings saved.")).toBeVisible();

  const tech = await acceptInvite(browser, await invite(page, techEmail, "Tina Tech", ["TECHNICIAN"]), true);
  const rita = await acceptInvite(browser, await invite(page, reporterEmail, "Rita Reporter", ["REQUESTER"]), true);

  // 1. Someone on site reports a fault from their phone, with a photo. Reporters get the simple home screen.
  await expect(rita.getByRole("heading", { name: "Hello, Rita" })).toBeVisible();
  await gotoReady(rita, "/requests/new");
  // The report is a guided form: one section at a time, then a review that reads like the requisition.
  await expect(rita.getByTestId("step-label")).toHaveText("Step 1 of 5 · What is wrong?");
  await next(rita); // required fields are checked before moving on
  await expect(rita.getByTestId("step-label")).toContainText("Step 1 of 5");
  await f(rita, "title").fill("Cold room door not sealing");
  await f(rita, "description").fill("Ice building up on the floor at the door.");
  await next(rita);
  await expect(rita.getByTestId("step-label")).toHaveText("Step 2 of 5 · How urgent is it?");
  await choosePriority(rita, "HIGH");
  await next(rita);
  await f(rita, "locationId").selectOption({ label: "Cold Room 2" });
  await next(rita);
  await f(rita, "files").setInputFiles(PHOTO);
  await next(rita);
  const review = rita.getByTestId("review");
  await expect(review).toContainText("Cold room door not sealing");
  await expect(review).toContainText("Cold Room 2");
  await expect(review).toContainText("High – affecting work");
  await expect(review).toContainText("icon-192.png");
  await rita.getByRole("button", { name: "Send report" }).click();
  await expect(rita.locator("p[role=alert]")).toContainText("sign the report"); // "Submitted by" signature required
  await sign(rita);
  await rita.getByRole("button", { name: "Send report" }).click();
  await expect(rita).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  await expect(rita.getByText(/^12600 ·/).first()).toBeVisible(); // requisition number continues the paper book
  inHouseJob = new URL(rita.url()).pathname;
  await expect(status(rita)).toHaveText("New report");
  await expect(rita.locator("summary", { hasText: "Send for assessment" })).toHaveCount(0); // reporters follow, they don't manage
  fileUrl = (await rita.locator('img[src^="/api/files/"]').last().getAttribute("src"))!;

  // 2. The maintenance manager screens it and sends it to a technician to assess.
  await gotoReady(page, inHouseJob);
  await expect(page.getByTestId("next-action")).toContainText("Review the report and send it for assessment");
  const send = await openPanel(page, "Send for assessment");
  await send.locator('[name="assessorId"]').selectOption({ label: "Tina Tech" });
  await sign(send); // "Submitted to" – received by maintenance
  await send.getByRole("button", { name: "Send for assessment" }).click();
  await expect(status(page)).toHaveText("Awaiting assessment");

  await gotoReady(tech, "/my-jobs");
  await tech.getByText("Cold room door not sealing").filter({ visible: true }).click();
  const assess = await openPanel(tech, "Record assessment");
  await assess.locator('[name="findings"]').fill("Door gasket torn along the bottom.");
  await assess.locator('[name="quoteRequired"]').selectOption("no");
  await assess.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status(tech)).toHaveText("Assessed – decide how to fix");
  await expect(tech.getByRole("heading", { name: "Contractor quotes" })).toHaveCount(0); // technicians never see pricing

  // 3. The manager decides: fix it in-house, then assigns the technician.
  await page.reload();
  const ih = await openPanel(page, "Fix it in-house");
  await ih.getByRole("button", { name: "Give to the in-house team" }).click();
  await expect(status(page)).toHaveText("Approved – awaiting assignment");
  const assign = await openPanel(page, "Assign a technician");
  await assign.locator('[name="leadTechnicianId"]').selectOption({ label: "Tina Tech" });
  await assign.locator('[name="instructions"]').fill("Gasket is in the store room.");
  await assign.getByRole("button", { name: "Assign job" }).click();
  await expect(status(page)).toHaveText("Assigned");
  await expect(page.getByText("In-house team").first()).toBeVisible();

  // 4. The technician starts, logs time, and must attach evidence to finish.
  await gotoReady(tech, inHouseJob);
  await expect(tech.getByText("Gasket is in the store room.")).toBeVisible();
  await tech.getByRole("button", { name: "Start work" }).click();
  await expect(status(tech)).toHaveText("In progress");
  const upd = await openPanel(tech, "Add update / note");
  await upd.locator('[name="note"]').fill("Old gasket removed.");
  await upd.locator('[name="labourMinutes"]').fill("45");
  await upd.getByRole("button", { name: "Add update" }).click();
  await expect(tech.getByText("Old gasket removed.")).toBeVisible();
  const done = await openPanel(tech, "Work finished – submit evidence");
  await done.locator('[name="workPerformed"]').fill("Fitted new gasket, door seals.");
  await next(done); // → photos (skipped for now)
  await next(done); // → root cause
  await next(done);
  await expect(done.locator("p[role=alert]")).toContainText("root cause"); // checked before moving on
  await done.getByLabel("Wear and tear").check();
  await done.locator('[name="rootCauseNotes"]').fill("Gasket perished; replace yearly.");
  await next(done);
  await expect(done.getByTestId("review")).toContainText("Wear and tear");
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(done.locator("p[role=alert]")).toContainText("after-photo"); // evidence is required by the server
  await done.getByRole("button", { name: "Edit Photos and documents" }).click();
  await done.locator('[name="after"]').setInputFiles(PHOTO);
  await next(done); await next(done);
  await sign(done); // "Work completed by"
  await done.getByRole("button", { name: "Submit for confirmation" }).click();
  await expect(status(tech)).toHaveText("Awaiting confirmation");

  // 5. The person who reported it confirms it is fixed. The manager cannot close before that.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign off and close" })).toHaveCount(0);
  await gotoReady(rita, "/dashboard");
  const ask = rita.getByTestId("needs-confirmation");
  await expect(ask).toContainText("Cold room door not sealing");
  await ask.getByRole("link", { name: "Confirm" }).click();
  await expect(rita.getByText("Fitted new gasket, door seals.")).toBeVisible();
  const yes = await openPanel(rita, "Is it fixed?");
  await yes.locator('[name="outcome"]').selectOption("APPROVED");
  await sign(yes); // "Confirmed by originator"
  await yes.getByRole("button", { name: "Send my answer" }).click();
  await expect(status(rita)).toHaveText("Confirmed fixed – ready to close");

  // 6. Close; complete history; printable report; insights count it.
  await page.reload();
  const close = await openPanel(page, "Sign off and close");
  await sign(close); // "Confirmed by manager"
  await close.getByRole("button", { name: "Sign off and close" }).click();
  await expect(status(page)).toHaveText("Closed");
  const timeline = page.getByTestId("timeline");
  for (const t of ["Fault reported", "Sent for assessment", "Assessment completed", "in-house", "Assigned to Tina Tech", "Work started", "Completion submitted", "Rita Reporter", "Job closed"]) await expect(timeline).toContainText(t);
  // The filled-in requisition: every line of the paper form, dated automatically and signed.
  await page.getByRole("link", { name: "Requisition form" }).click();
  const form = page.getByTestId("requisition");
  await expect(form).toContainText(owner.company); // shown in capitals, like the printed form
  await expect(page.getByTestId("requisition-number")).toHaveText("12600");
  await expect(page.getByTestId("submitted-by")).toContainText("Rita Reporter");
  await expect(page.getByTestId("submitted-to")).toContainText("Olive Owner");
  await expect(page.getByTestId("maintenance-report")).toContainText("Fitted new gasket");
  const ticked = page.getByTestId("root-cause-boxes").locator('[data-checked="true"]');
  await expect(ticked).toHaveCount(1);
  await expect(ticked).toContainText("Wear and tear");
  await expect(page.getByTestId("completed-by")).toContainText("Tina Tech");
  await expect(page.getByTestId("confirmed-originator")).toContainText("Rita Reporter");
  await expect(page.getByTestId("confirmed-manager")).toContainText("Olive Owner");
  for (const step of ["REPORTED", "RECEIVED", "COMPLETED", "ORIGINATOR", "MANAGER"]) {
    const img = page.getByTestId(`sig-${step}`).locator("img");
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), step).toBe(true);
  }
  await expect(page.getByTestId("date-reported")).not.toHaveText("Date reported:");
  await expect(page.getByTestId("report-history")).toContainText("Job closed");
  await gotoReady(page, "/reports");
  await expect(page.locator(".card", { hasText: "Jobs closed" }).first()).toContainText("1");

  // Reopen with a reason goes back to the same technician.
  await gotoReady(page, inHouseJob);
  const re = await openPanel(page, "Reopen job");
  await re.locator('[name="reason"]').fill("Ice is back after two days");
  await re.getByRole("button", { name: "Reopen job" }).click();
  await expect(status(page)).toHaveText("Assigned");
  await expect(page.getByText("Reopened ×1")).toBeVisible();
});

test("contractor journey: quotes by secure link → compare → over-limit goes to approver → PO → contractor completes → confirm → close", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await gotoReady(page, "/login");
  await f(page, "email").fill(owner.email);
  await f(page, "password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Approval rules: the owner sets limits; a finance approver approves bigger spend with a PO.
  await gotoReady(page, "/settings");
  const rules = card(page, "Approval rules");
  await rules.locator('[name="managerLimit"]').fill("5000");
  await rules.locator('[name="approverLimit"]').fill("");
  await rules.locator('[name="quoteThreshold"]').fill("10000");
  await rules.locator('[name="minQuotes"]').fill("2");
  await rules.locator('[name="poRequired"]').check();
  await rules.getByRole("button", { name: "Save approval rules" }).click();
  await expect(page.getByText("Approval rules saved.")).toBeVisible();
  // A manager (limit R 5 000) runs the job; the owner would be unlimited.
  const mgr = await acceptInvite(browser, await invite(page, `mgr-${id}@e2e.example`, "Mo Manager", ["MANAGER"]));
  const fin = await acceptInvite(browser, await invite(page, approverEmail, "Fiona Finance", ["APPROVER"]));
  mgr.on("dialog", (d) => d.accept());
  await addContractor(page, cool.name, cool.email, true);
  await addContractor(page, sparks.name, sparks.email, false);

  // Fault logged and assessed: needs a contractor.
  const job = await logRequest(mgr, "Compressor 2 tripping on overload", undefined, { sign: true, priority: "HIGH" });
  const a = await openPanel(mgr, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Start capacitor degraded; contactor pitted.");
  await a.locator('[name="quoteRequired"]').selectOption("yes");
  await sign(a);
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status(mgr)).toHaveText("Assessed – decide how to fix");

  // Ask both contractors for a quote.
  const rfq = await openPanel(mgr, "Get contractor quotes");
  await rfq.getByLabel(cool.name).check();
  await rfq.getByLabel(sparks.name).check();
  await rfq.locator('[name="scope"]').fill("Replace capacitor and contactor, test run 1 hour.");
  await rfq.getByRole("button", { name: "Send quote requests" }).click();
  await expect(rfq.getByTestId("share-link")).toBeVisible(); // stays on screen so it can also be sent by WhatsApp
  await mgr.reload();
  await expect(status(mgr)).toHaveText("Getting quotes");

  // Each contractor opens the emailed link (no account) and quotes. VAT only for the VAT-registered one.
  const coolLink = pathFrom((await lastEmail(cool.email, /Request for quotation/)).body, "c");
  const sparksLink = pathFrom((await lastEmail(sparks.email, /Request for quotation/)).body, "c");
  loserQuoteLink = sparksLink;
  const c1 = await newPage(browser, { mobile: true });
  await gotoReady(c1, coolLink);
  await expect(c1.getByTestId("rfq-scope")).toContainText("Replace capacitor and contactor, test run 1 hour.");
  await f(c1, "price").fill("6 000");
  await f(c1, "scope").fill("Capacitor, contactor, labour and call-out.");
  await f(c1, "leadTimeDays").fill("1");
  await c1.getByRole("button", { name: "Submit quote" }).click();
  await expect(c1.getByTestId("my-quote")).toContainText("R 6 900.00");
  const c2 = await newPage(browser);
  await gotoReady(c2, sparksLink);
  await f(c2, "price").fill("7400");
  await f(c2, "scope").fill("Capacitor and contactor replacement.");
  await c2.getByRole("button", { name: "Submit quote" }).click();
  await expect(c2.getByTestId("my-quote")).toContainText("R 7 400.00");

  // Side-by-side comparison; the cheapest is marked. R 6 900 is above the manager's R 5 000 limit.
  await mgr.reload();
  const compare = mgr.getByTestId("quote-compare");
  await expect(compare).toContainText("Cheapest");
  await expect(compare.locator("tr", { hasText: cool.name })).toContainText("R 6 900.00");
  await expect(compare.locator("tr", { hasText: sparks.name })).toContainText("R 7 400.00");
  const choose = mgr.getByTestId(`choose-${cool.name}`);
  await choose.locator("summary").click();
  await expect(choose).toContainText("above your limit");
  await choose.getByRole("button", { name: "Send for approval" }).click();
  await expect(status(mgr)).toHaveText("Awaiting spend approval");

  // The approver sees it on their dashboard and approves it with a PO number.
  await gotoReady(fin, "/dashboard");
  const needs = fin.getByTestId("needs-approval");
  await expect(needs).toContainText("Compressor 2 tripping on overload");
  await expect(needs).toContainText("R 6 900.00");
  await needs.getByRole("link", { name: "Review" }).click();
  const decide = fin.getByTestId("approval-decision");
  await expect(decide.locator('[name="poNumber"]')).toHaveAttribute("required", ""); // PO required by the rules
  await decide.locator('[name="poNumber"]').fill("PO-2001");
  await sign(decide); // quote signed off
  await decide.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(status(fin)).toHaveText("Assigned");
  await expect(fin.getByText("PO-2001").first()).toBeVisible();

  // The losing contractor's link is closed and they are told; the winner gets a completion link.
  await gotoReady(c2, sparksLink);
  await expect(c2.getByTestId("link-closed")).toBeVisible();
  await lastEmail(sparks.email, /not selected/);
  const doneLink = pathFrom((await lastEmail(cool.email, /You have been appointed/)).body, "c");
  await gotoReady(c1, doneLink);
  await expect(c1.getByText("PO-2001").first()).toBeVisible();
  await f(c1, "workPerformed").fill("Replaced capacitor and contactor; ran for one hour, no trips.");
  await next(c1);
  await expect(f(c1, "files")).toHaveAttribute("required", ""); // a photo is required (also enforced on the server)
  await f(c1, "files").setInputFiles(PHOTO);
  await next(c1);
  await c1.getByLabel("Age of machine").check();
  await next(c1);
  await f(c1, "signerName").fill("Sipho Dlamini");
  await sign(c1);
  await c1.getByRole("button", { name: "Submit completion" }).click();
  await expect(c1.getByTestId("completion-received")).toBeVisible();
  await gotoReady(c1, doneLink); // single use
  await expect(c1.getByRole("button", { name: "Submit completion" })).toHaveCount(0);

  // The manager reported it, so they confirm it's fixed, with a signature from the operator on their device.
  await gotoReady(mgr, job);
  await expect(status(mgr)).toHaveText("Awaiting confirmation");
  const so = await openPanel(mgr, "Get the reporter's signature on this device");
  await so.locator('[name="name"]').fill("Sipho Operator");
  await so.locator('[name="outcome"]').selectOption("APPROVED");
  await sign(so);
  await so.getByRole("button", { name: "Record sign-off" }).click();
  await expect(status(mgr)).toHaveText("Confirmed fixed – ready to close");
  const close = await openPanel(mgr, "Sign off and close");
  await sign(close);
  await close.getByRole("button", { name: "Sign off and close" }).click();
  await expect(status(mgr)).toHaveText("Closed");
  const t = mgr.getByTestId("timeline");
  for (const x of ["Quotes requested", "CoolTech Refrigeration", "Fiona Finance", "PO-2001", "Job closed"]) await expect(t).toContainText(x);
  await expect(mgr.locator('img[alt^="Signature of"]').first()).toBeVisible();

  // Contractor performance shows on Insights.
  await gotoReady(page, "/reports");
  await expect(card(page, "Contractor performance")).toContainText(cool.name);
});

test("QR reporting without an account: off by default; when on, the scanned location is pre-filled and the report lands for screening", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await gotoReady(page, "/login");
  await f(page, "email").fill(owner.email);
  await f(page, "password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await gotoReady(page, sitePath);
  const link = new URL(await page.getByTestId("site-report-link").inputValue()).pathname;
  expect(link).toMatch(/^\/r\/[a-z2-9]{10}$/); // short code, no database ids
  const anon = await newPage(browser, { mobile: true });
  await gotoReady(anon, link);
  await expect(anon).toHaveURL(/login/); // public reporting is off: staff are asked to sign in

  await gotoReady(page, "/settings");
  await f(page, "publicReportingEnabled").check();
  await page.getByRole("button", { name: "Save company settings" }).click();
  await expect(page.getByText("Company settings saved.")).toBeVisible();

  // The QR sheet has one label for the site and one per location.
  await gotoReady(page, `${sitePath}/qr`);
  await expect(page.getByText("Scan to report a fault")).toHaveCount(3);
  const loc = await db.location.findFirstOrThrow({ where: { name: "Packing Hall", site: { publicCode: link.slice(3) } } });

  await gotoReady(anon, `/r/${loc.publicCode}`); // the area's own QR code
  await expect(anon.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await anon.getByText("Unsafe", { exact: true }).click();
  await f(anon, "description").fill("Conveyor guard loose – rattles when the belt runs.");
  await next(anon);
  await choosePriority(anon, "CRITICAL"); // the reporter says how urgent it is
  await next(anon);
  await expect(anon.getByTestId("place-confirm")).toContainText("Packing Hall"); // filled in from the QR code
  await next(anon); await next(anon); // photo is optional
  await f(anon, "reporterName").fill("Vusi Visitor");
  await f(anon, "reporterPhone").fill("082 555 0101");
  await next(anon);
  await expect(anon.getByTestId("review")).toContainText("Packing Hall");
  await sign(anon); // signatures are required in this company (set in the first journey)
  await anon.getByRole("button", { name: "Send report" }).click();
  await expect(anon.getByTestId("report-number")).toHaveText(/^126\d\d$/);

  await gotoReady(page, "/dashboard");
  await expect(page.locator("a.card", { hasText: "Public reports to screen" })).toContainText("1");
  await page.locator("a.card", { hasText: "Public reports to screen" }).click();
  await page.getByText("Conveyor guard loose").filter({ visible: true }).first().click();
  await expect(page.getByTestId("public-reporter")).toContainText("Vusi Visitor");
  await expect(page.getByText("Packing Hall").first()).toBeVisible();

  // A new link makes the printed QR codes stop working.
  await gotoReady(page, sitePath);
  await page.getByRole("button", { name: "Replace link" }).click();
  await expect(page.getByText(/old ones no longer work/)).toBeVisible();
  await gotoReady(anon, link);
  await expect(anon.getByText("This report link is not active")).toBeVisible();
});

test("permissions and tenancy: technicians and reporters are limited; another company sees nothing", async ({ browser }) => {
  const t = await newPage(browser);
  await gotoReady(t, "/login");
  await f(t, "email").fill(techEmail);
  await f(t, "password").fill("correct-horse-battery");
  await t.getByRole("button", { name: "Sign in" }).click();
  await expect(t).not.toHaveURL(/login/);
  for (const p of ["/settings", "/quotes", "/reports", "/contractors", "/platform"]) { await gotoReady(t, p); await expect(t).toHaveURL(/forbidden/); }

  // The reporter can't see someone else's job (the contractor job), only their own.
  const r = await newPage(browser);
  await gotoReady(r, "/login");
  await f(r, "email").fill(reporterEmail);
  await f(r, "password").fill("correct-horse-battery");
  await r.getByRole("button", { name: "Sign in" }).click();
  await expect(r).toHaveURL(/dashboard/);
  const org = await db.organisation.findFirstOrThrow({ where: { name: owner.company } });
  const other = await db.job.findFirstOrThrow({ where: { title: "Compressor 2 tripping on overload", orgId: org.id } });
  expect((await r.goto(`/jobs/${other.id}`))!.status()).toBe(404);
  await gotoReady(r, "/jobs");
  await expect(r.getByText("Compressor 2 tripping").filter({ visible: true })).toHaveCount(0);

  // Signed-out visitors: sent to sign in; files are not served; bad contractor links explain themselves.
  const anon = await newPage(browser);
  await anon.goto(inHouseJob);
  await expect(anon).toHaveURL(/login/);
  expect((await anon.request.get(fileUrl)).status()).toBe(404);
  await gotoReady(anon, "/c/" + "A".repeat(43));
  await expect(anon.getByText("This link is not valid")).toBeVisible();
  await gotoReady(anon, loserQuoteLink);
  await expect(anon.getByTestId("link-closed")).toBeVisible();

  // A second company cannot reach the first company's jobs or files.
  const rival = await newPage(browser);
  await register(rival, { email: `rival-${id}@e2e.example`, company: `Rival Mills ${id}` });
  expect((await rival.goto(inHouseJob))!.status()).toBe(404);
  expect((await rival.request.get(fileUrl)).status()).toBe(404);
  expect((await rival.request.get(`${inHouseJob}/report`)).status()).toBe(404);
  expect((await rival.goto(sitePath))!.status()).toBe(404);
  const manifest = await (await rival.request.get("/api/manifest")).json();
  expect(manifest.name).toContain("Rival Mills");
});
