import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { type Browser, type BrowserContextOptions, expect, type Locator, type Page } from "@playwright/test";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test";
export const db = new PrismaClient({ datasourceUrl: DB_URL });
export const PASSWORD = "correct-horse-battery";
export const uid = () => Math.random().toString(36).slice(2, 8);

/** Form control by name (avoids matching <meta name="description">). */
export const f = (p: Page | Locator, name: string) => p.locator(`:is(input,select,textarea)[name="${name}"]`);
export const card = (p: Page, title: string) => p.locator("section.card", { has: p.getByRole("heading", { name: title, exact: true }) });
export const alertText = (p: Page | Locator) => p.locator("p[role=alert]");
export async function openPanel(p: Page, label: string) {
  const d = p.locator("details.action", { has: p.locator("summary", { hasText: label }) });
  if ((await d.getAttribute("open")) === null) await d.locator("summary").click();
  return d;
}

/** Each browser context gets its own client IP (as a trusted proxy would report), so the shared rate limiter sees distinct users. */
export async function newPage(b: Browser, opts: BrowserContextOptions & { mobile?: boolean } = {}) {
  const { mobile, ...rest } = opts;
  const ip = `198.51.100.${randomInt(1, 254)}, 203.0.113.${randomInt(1, 254)}`;
  const ctx = await b.newContext({
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
    extraHTTPHeaders: { "x-forwarded-for": ip }, ...rest,
  });
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.accept());
  return p;
}

export async function gotoReady(p: Page, url: string) {
  await p.goto(url);
  await p.waitForLoadState("networkidle");
}

/** Newest queued email to an address (bodies are kept until the worker sends them; no worker runs in e2e). */
export async function lastEmail(to: string, subject?: RegExp) {
  await expect.poll(async () => (await db.outboxEmail.findMany({ where: { toEmail: to }, orderBy: { createdAt: "desc" } })).find((e) => !subject || subject.test(e.subject))?.body ?? "").not.toBe("");
  const rows = await db.outboxEmail.findMany({ where: { toEmail: to }, orderBy: { createdAt: "desc" } });
  return rows.find((e) => !subject || subject.test(e.subject))!;
}
export const pathFrom = (body: string, prefix: string) => new URL(new RegExp(`https?://\\S+/${prefix}/[A-Za-z0-9_-]{43}`).exec(body)![0]).pathname;

export async function register(p: Page, who: { email: string; company: string; name?: string }) {
  await gotoReady(p, "/register");
  await f(p, "companyName").fill(who.company);
  await f(p, "name").fill(who.name ?? "Olive Owner");
  await f(p, "email").fill(who.email);
  await f(p, "password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await expect(p).toHaveURL(/dashboard/);
}

export async function verifyEmail(p: Page, email: string) {
  const mail = await lastEmail(email, /Confirm your email/);
  await gotoReady(p, pathFrom(mail.body, "verify-email"));
  await expect(p.getByTestId("verified")).toBeVisible();
}

/** Adds a site (and optional locations) and returns its page path. */
export async function addSite(p: Page, name = "Germiston Plant", locations: string[] = []) {
  await gotoReady(p, "/sites");
  const add = card(p, "Add a site");
  await add.locator('[name="name"]').fill(name);
  await add.locator('[name="address"]').fill("14 Refinery Rd, Germiston");
  await add.getByRole("button", { name: "Add site" }).click();
  await expect(p).toHaveURL(/sites\/[0-9a-f-]{36}$/);
  const sitePath = new URL(p.url()).pathname;
  for (const l of locations) {
    await p.getByPlaceholder("Add a location, e.g. Plant room").fill(l);
    await p.getByRole("button", { name: "Add location" }).click();
    await expect(p.locator(".badge, span", { hasText: new RegExp(`^${l}`) }).filter({ visible: true }).first()).toBeVisible();
    await p.waitForLoadState("networkidle");
  }
  return sitePath;
}

/** Adds a contractor; quote requests go to their email (queued in the outbox). */
export async function addContractor(p: Page, name: string, email: string, vat = false) {
  await gotoReady(p, "/contractors");
  const add = card(p, "Add a contractor");
  await add.locator('[name="name"]').fill(name);
  await add.locator('[name="trade"]').fill("Refrigeration");
  await add.locator('[name="email"]').fill(email);
  if (vat) { await add.locator('[name="vatRegistered"]').check(); await add.locator('[name="vatNumber"]').fill("4123456789"); }
  await add.getByRole("button", { name: "Add contractor" }).click();
  await expect(p).toHaveURL(/contractors\/[0-9a-f-]{36}$/);
}

/** Registered, verified company with one site. */
export async function company(b: Browser) {
  const p = await newPage(b);
  const email = `owner-${uid()}@e2e.example`;
  await register(p, { email, company: `E2E Foods ${uid()}` });
  await verifyEmail(p, email);
  const sitePath = await addSite(p, "Germiston Plant", ["Cold Room 2"]);
  return { p, email, sitePath };
}

export async function invite(p: Page, email: string, name: string, roles: string[]) {
  await gotoReady(p, "/settings");
  const inv = card(p, "Invite someone");
  await inv.locator('[name="email"]').fill(email);
  await inv.locator('[name="name"]').fill(name);
  for (const box of await inv.locator('[name="roles"]').all()) await box.setChecked(roles.includes((await box.getAttribute("value"))!));
  await inv.getByRole("button", { name: "Send invitation" }).click();
  return shareLink(inv);
}

export async function acceptInvite(b: Browser, path: string, mobile = false) {
  const q = await newPage(b, { mobile });
  await gotoReady(q, path);
  await f(q, "password").fill(PASSWORD);
  await q.getByRole("button", { name: "Accept invitation" }).click();
  await expect(q).toHaveURL(/dashboard/);
  return q;
}

/** Click "Next →" in a guided (step-by-step) form. */
export async function next(scope: Page | Locator) {
  await scope.getByRole("button", { name: "Next →" }).click();
}

/**
 * Report a fault through the guided form: What is wrong? → Where is it? → Add a photo → Check and sign.
 * `extra` runs on the first step (e.g. choose urgency); `opts.location` picks the area; `opts.sign` signs on the review step.
 */
export async function logRequest(p: Page, title: string, extra: (p: Page) => Promise<void> = async () => {}, opts: { sign?: boolean; location?: string } = {}) {
  await gotoReady(p, "/requests/new");
  await f(p, "title").fill(title);
  await f(p, "description").fill("Reported during e2e test.");
  await extra(p);
  await next(p);
  // "Where is it?": the named area, or the site's first area when none is chosen yet.
  const loc = f(p, "locationId");
  if (opts.location) await loc.selectOption({ label: opts.location });
  else if (!(await loc.inputValue()) && (await loc.locator("option").count()) > 1) await loc.selectOption({ index: 1 });
  await next(p); await next(p);
  await expect(p.getByTestId("review")).toContainText(title);
  if (opts.sign) await sign(p);
  await p.getByRole("button", { name: "Send report" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  return new URL(p.url()).pathname;
}

export const status = (p: Page) => p.locator(".badge").first();

export async function shareLink(scope: Locator) {
  return new URL(await scope.getByTestId("share-link").locator("input").inputValue()).pathname;
}

/** Draw a signature on the (visible) signature pad inside `scope` – a form, panel or the whole page. */
export async function sign(scope: Page | Locator) {
  const pad = scope.getByTestId("signature-pad").filter({ visible: true }).first();
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await pad.dispatchEvent("pointerdown", { clientX: box.x + 20, clientY: box.y + 30, pointerId: 1 });
  await pad.dispatchEvent("pointermove", { clientX: box.x + 120, clientY: box.y + 60, pointerId: 1 });
  await pad.dispatchEvent("pointerup", { clientX: box.x + 120, clientY: box.y + 60, pointerId: 1 });
}
