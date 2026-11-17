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

/** Registered, verified company with one customer and site. */
export async function company(b: Browser) {
  const p = await newPage(b);
  const email = `owner-${uid()}@e2e.example`;
  await register(p, { email, company: `E2E Co ${uid()}` });
  await verifyEmail(p, email);
  await gotoReady(p, "/customers");
  const add = card(p, "Add a customer");
  await add.locator('[name="name"]').fill("Karoo Cold Storage");
  await add.locator('[name="contactName"]').fill("Carl Customer");
  await add.locator('[name="email"]').fill(`carl-${uid()}@client.example`);
  await add.getByRole("button", { name: "Add customer" }).click();
  await expect(p).toHaveURL(/customers\/[0-9a-f-]{36}/);
  const customerUrl = new URL(p.url()).pathname;
  const site = await openPanel(p, "Add a site");
  await site.locator('[name="name"]').fill("Germiston Depot");
  await site.getByRole("button", { name: "Add site" }).click();
  await expect(p.getByText("Germiston Depot").first()).toBeVisible();
  return { p, email, customerUrl };
}

export async function logRequest(p: Page, title: string, extra: (p: Page) => Promise<void> = async () => {}) {
  await gotoReady(p, "/requests/new");
  await f(p, "title").fill(title);
  await f(p, "description").fill("Reported during e2e test.");
  await extra(p);
  await p.getByRole("button", { name: "Log request" }).click();
  await expect(p).toHaveURL(/jobs\/[0-9a-f-]{36}$/);
  return new URL(p.url()).pathname;
}

export async function shareLink(scope: Locator) {
  return new URL(await scope.getByTestId("share-link").locator("input").inputValue()).pathname;
}
