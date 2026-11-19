import path from "node:path";
import { expect, test } from "@playwright/test";
import { acceptInvite, choosePriority, company, f, gotoReady, invite, logRequest, newPage, next, openPanel, uid } from "./helpers";

const PHOTO = path.join(__dirname, "..", "public", "icon-192.png");

test("B1 · jobs board: Open now and History tabs, priority chips with counts, critical first, photo on the card", async ({ browser }) => {
  const { p } = await company(browser);
  // A critical fault with a photo, reported through the guided form.
  await gotoReady(p, "/requests/new");
  await f(p, "title").fill("Gas smell in the kitchen");
  await f(p, "description").fill("Strong smell near the stove.");
  await next(p);
  await choosePriority(p, "CRITICAL");
  await next(p); await next(p);
  await f(p, "files").setInputFiles(PHOTO);
  await next(p);
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  await expect(p.getByText("Critical").first()).toBeVisible();
  const paint = await logRequest(p, "Paint chipped on railing", undefined, { priority: "LOW" });
  await logRequest(p, "Door sticks in wet weather");

  await gotoReady(p, "/jobs");
  const chips = p.getByTestId("priority-chips");
  await expect(chips.getByRole("link", { name: /^All/ })).toContainText("3");
  await expect(chips.getByRole("link", { name: /^Critical/ })).toContainText("1");
  await expect(chips.getByRole("link", { name: /^Medium/ })).toContainText("1");
  await expect(chips.getByRole("link", { name: /^Low/ })).toContainText("1");
  const rows = p.locator("tbody tr");
  await expect(rows.first()).toContainText("Gas smell in the kitchen"); // most urgent first
  await expect(rows.first().getByTestId("job-photo")).toBeVisible();

  await chips.getByRole("link", { name: /^Critical/ }).click();
  await expect(p).toHaveURL(/priority=CRITICAL/);
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole("link", { name: "Gas smell in the kitchen" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Gas smell in the kitchen");
  await expect(p.locator('img[alt="icon-192.png"]')).toBeVisible(); // the job card shows the photo

  // Finished work moves to History.
  await gotoReady(p, paint);
  const cancel = await openPanel(p, "Cancel job");
  await cancel.locator('[name="reason"]').fill("Not needed after all");
  await cancel.getByRole("button", { name: "Cancel job" }).click();
  await expect(p.getByText("Cancelled: Not needed after all").first()).toBeVisible();
  await gotoReady(p, "/jobs");
  await expect(p.getByTestId("priority-chips").getByRole("link", { name: /^All/ })).toContainText("2");
  await p.getByTestId("job-tabs").getByRole("link", { name: "History" }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Job history");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Paint chipped on railing");

  // Phones get cards with the photo.
  const phone = await newPage(browser, { mobile: true, storageState: await p.context().storageState() });
  await gotoReady(phone, "/jobs");
  const first = phone.getByTestId("job-card").first();
  await expect(first).toContainText("Gas smell in the kitchen");
  await expect(first.getByTestId("job-photo")).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("B2 · spares: asked for at the assessment, stores are told, order it and mark it received; the technician is told", async ({ browser }) => {
  const { p } = await company(browser);
  const link = await invite(p, `stores-${uid()}@e2e.example`, "Sam Stores", ["STORES"]);
  const stores = await acceptInvite(browser, link);
  const url = await logRequest(p, "Conveyor bearing noisy", undefined, { priority: "HIGH" });

  // Stores see nothing until spares are needed.
  await gotoReady(stores, "/jobs");
  await expect(stores.getByText("No open jobs")).toBeVisible();

  await gotoReady(p, url);
  const a = await openPanel(p, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Bearing worn on the drive end.");
  await a.locator('[name="sparesNeeded"]').selectOption("TO_BUY");
  await a.locator('[name="quoteRequired"]').selectOption("no");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await expect(a.locator("p[role=alert]")).toContainText("List the spares"); // the list is needed
  await a.locator('[name="sparesList"]').fill("2 × 6204 bearings");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  await expect(p.getByTestId("spares-card")).toContainText("2 × 6204 bearings");
  await expect(p.getByText("Spares to buy – stores to order")).toBeVisible();

  // Stores: told, and the job is on their dashboard under "Spares to order".
  await gotoReady(stores, "/notifications");
  await expect(stores.getByText(/spares to buy/i).first()).toBeVisible();
  await gotoReady(stores, "/dashboard");
  const queue = stores.getByTestId("stores-queue");
  await expect(queue.getByRole("heading", { name: /Spares to order/ })).toContainText("(1)");
  await queue.getByRole("link", { name: "Conveyor bearing noisy" }).filter({ visible: true }).first().click();
  const ordered = await openPanel(stores, "Ordered from a supplier");
  await ordered.locator('[name="note"]').fill("Bearing Man, PO 4471");
  await ordered.locator('[name="eta"]').fill("2026-12-01");
  await ordered.getByRole("button", { name: "Mark as ordered" }).click();
  await expect(stores.getByText("Spares ordered – waiting for delivery")).toBeVisible();
  await expect(stores.getByTestId("spares-card")).toContainText("Bearing Man, PO 4471");
  const arrived = await openPanel(stores, "Spares arrived");
  await arrived.getByRole("button", { name: "Mark as received" }).click();
  await expect(stores.getByText("Spares ready", { exact: true })).toBeVisible();
  // Stores cannot run the maintenance workflow.
  await expect(stores.getByText("Fix it in-house")).toHaveCount(0);

  // The manager sees the history of the spares.
  await gotoReady(p, url);
  await expect(p.getByText("Spares ready", { exact: true })).toBeVisible();
  await expect(p.getByText(/Spares ordered: Bearing Man, PO 4471|Spares ordered, expected 2026-12-01: Bearing Man/).first()).toBeVisible();
});
