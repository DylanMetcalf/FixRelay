import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { acceptInvite, addContractor, alertText, card, company, db, f, gotoReady, invite, lastEmail, logRequest, newPage, openPanel, PASSWORD, pathFrom, register, status, uid, verifyEmail } from "./helpers";

test.afterAll(async () => { await db.$disconnect(); });

test("1 · landing page explains the product and leads to sign-up; signed-in users skip it", async ({ browser }) => {
  const p = await newPage(browser);
  await gotoReady(p, "/");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("From reported to resolved.");
  await expect(p.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(p.locator("#how li")).toHaveCount(5);
  await expect(p.getByRole("link", { name: "Privacy" }).first()).toHaveAttribute("href", "/privacy");
  await p.getByRole("link", { name: "Start your free 14-day trial" }).click();
  await expect(p).toHaveURL(/register/);
  await register(p, { email: `land-${uid()}@e2e.example`, company: `Landing ${uid()}` });
  await gotoReady(p, "/");
  await expect(p).toHaveURL(/dashboard/);
  for (const path of ["/privacy", "/terms"]) { await gotoReady(p, path); await expect(p.getByText("Template – have it reviewed.")).toBeVisible(); }
});

test("2 · installable PWA: manifest, icons, shortcuts, screenshots and an active service worker", async ({ browser }) => {
  const p = await newPage(browser);
  await gotoReady(p, "/login");
  const m = await (await p.request.get("/api/manifest")).json();
  expect(m).toMatchObject({ name: "ManOp", short_name: "ManOp", display: "standalone", start_url: expect.stringContaining("/dashboard"), theme_color: "#0B1F3A" });
  expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(expect.arrayContaining(["/requests/new", "/my-jobs"]));
  for (const src of [...m.icons.map((i: { src: string }) => i.src), ...m.screenshots.map((s: { src: string }) => s.src), "/apple-touch-icon.png", "/brand/og.png", "/offline.html"]) {
    const r = await p.request.get(src);
    expect(r.status(), src).toBe(200);
  }
  await expect(p.locator('link[rel="manifest"]')).toHaveAttribute("href", "/api/manifest");
  await expect(p.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  const scope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});

test("3 · offline: once installed, losing the connection shows the branded offline page (no tenant data cached)", async ({ browser }) => {
  const p = await newPage(browser);
  await gotoReady(p, "/login");
  // First visit: the service worker installs and takes control WITHOUT reloading the page (typed input survives).
  await f(p, "email").fill("typed-on-first-visit@example.com");
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(f(p, "email")).toHaveValue("typed-on-first-visit@example.com");
  await p.reload(); // now controlled by the service worker
  await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await p.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat());
  expect(cached.some((u) => u.startsWith("/dashboard") || u.startsWith("/jobs") || u.startsWith("/api/"))).toBe(false);
  await p.context().setOffline(true);
  await p.goto("/dashboard").catch(() => {});
  await expect(p.getByRole("heading", { name: "You are offline" })).toBeVisible();
  await p.context().setOffline(false);
});

test("4 · email confirmation is required before inviting people, and the emailed link unlocks it", async ({ browser }) => {
  const p = await newPage(browser);
  const email = `verify-${uid()}@e2e.example`;
  await register(p, { email, company: `Verify ${uid()}` });
  await expect(p.getByText("Please confirm your email address.")).toBeVisible();
  await gotoReady(p, "/settings");
  const inv = card(p, "Invite someone");
  await inv.locator('[name="email"]').fill(`t-${uid()}@e2e.example`);
  await inv.getByRole("button", { name: "Send invitation" }).click();
  await expect(alertText(inv)).toContainText("confirm your email");
  await p.getByRole("button", { name: "Resend link" }).click();
  await expect(p.getByText(/We sent a new confirmation link/)).toBeVisible();
  await verifyEmail(p, email);
  await gotoReady(p, "/settings");
  await expect(p.getByText("Please confirm your email address.")).toHaveCount(0);
  const again = card(p, "Invite someone");
  await again.locator('[name="email"]').fill(`t-${uid()}@e2e.example`);
  await again.getByRole("button", { name: "Send invitation" }).click();
  await expect(again.getByTestId("share-link")).toBeVisible();
});

test("5 · forgot password: same answer for unknown emails, single-use link, old password stops working", async ({ browser }) => {
  const p = await newPage(browser);
  const email = `reset-${uid()}@e2e.example`;
  await register(p, { email, company: `Reset ${uid()}` });
  await p.locator("aside").getByRole("button", { name: "Sign out" }).click();
  await expect(p).toHaveURL(/login/);
  await p.getByRole("link", { name: "Forgot password?" }).click();
  await expect(p).toHaveURL(/forgot-password/);
  await p.waitForLoadState("networkidle");
  await f(p, "email").fill(`nobody-${uid()}@e2e.example`);
  await p.getByRole("button", { name: "Send reset link" }).click();
  const generic = p.getByText(/If that email address has a ManOp account/);
  await expect(generic).toBeVisible();
  await gotoReady(p, "/forgot-password");
  await f(p, "email").fill(email);
  await p.getByRole("button", { name: "Send reset link" }).click();
  await expect(generic).toBeVisible();
  const link = pathFrom((await lastEmail(email, /Reset your ManOp password/)).body, "reset-password");
  await gotoReady(p, link);
  await f(p, "password").fill("brand-new-password-1");
  await f(p, "confirm").fill("brand-new-password-2");
  await p.getByRole("button", { name: "Save password and sign in" }).click();
  await expect(alertText(p)).toContainText("do not match");
  await expect(f(p, "password")).toHaveValue("brand-new-password-1"); // input kept after an error
  await f(p, "confirm").fill("brand-new-password-1");
  await p.getByRole("button", { name: "Save password and sign in" }).click();
  await expect(p).toHaveURL(/dashboard/);
  await gotoReady(p, link); // used link while signed in → straight to the dashboard
  await expect(p).toHaveURL(/dashboard/);
  const anon = await newPage(browser);
  await gotoReady(anon, link); // used link for anyone else → explained
  await expect(anon.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await p.locator("aside").getByRole("button", { name: "Sign out" }).click();
  await gotoReady(p, "/login");
  await f(p, "email").fill(email);
  await f(p, "password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(alertText(p)).toContainText("Incorrect email or password");
});

test("6 · a bogus or expired reset link explains what to do", async ({ browser }) => {
  const p = await newPage(browser);
  await gotoReady(p, `/reset-password/${"A".repeat(43)}`);
  await expect(p.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await p.getByRole("link", { name: "Send a new link" }).click();
  await expect(p).toHaveURL(/forgot-password/);
  await gotoReady(p, `/verify-email/${"B".repeat(43)}`);
  await expect(p.getByRole("heading", { name: "This link is no longer valid" })).toBeVisible();
});

test("7 · password fields have a working show/hide toggle", async ({ browser }) => {
  const p = await newPage(browser, { mobile: true });
  await gotoReady(p, "/login");
  await f(p, "password").fill("secret-value");
  await expect(f(p, "password")).toHaveAttribute("type", "password");
  await p.getByRole("button", { name: "Show" }).click();
  await expect(f(p, "password")).toHaveAttribute("type", "text");
  await expect(p.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
});

test("8 · uploads: photo location data is removed and PDFs with scripts are refused", async ({ browser }) => {
  const { p } = await company(browser);
  const jobUrl = await logRequest(p, "Leaking valve");
  const gpsPhoto = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#7c8a99" } })
    .jpeg().withMetadata({ exif: { IFD0: { Make: "PhoneCo" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "26/1 12/1 0/1" } } }).toBuffer();
  expect((await sharp(gpsPhoto).metadata()).exif).toBeDefined();
  const panel = await openPanel(p, "Add photos to the report");
  await panel.locator('input[type="file"]').setInputFiles({ name: "valve.jpg", mimeType: "image/jpeg", buffer: gpsPhoto });
  await panel.getByRole("button", { name: "Upload" }).click();
  await expect(p.getByText("Uploaded.")).toBeVisible();
  const src = await p.locator('img[alt="valve.jpg"]').getAttribute("src");
  const stored = await (await p.request.get(src!)).body();
  const meta = await sharp(stored).metadata();
  expect(meta.exif).toBeUndefined();
  expect(stored.toString("latin1")).not.toContain("PhoneCo");

  await gotoReady(p, jobUrl);
  const again = await openPanel(p, "Add photos to the report");
  await again.locator('input[type="file"]').setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF") });
  await again.getByRole("button", { name: "Upload" }).click();
  await expect(alertText(again)).toContainText("active content");
});

test("9 · three-quote rule: above the threshold, approving with too few quotes needs a written reason that is kept", async ({ browser }) => {
  const { p } = await company(browser);
  await addContractor(p, "LiftRight Forklifts", `lift-${uid()}@contractor.example`);
  const jobUrl = await logRequest(p, "Forklift hydraulic leak");
  const a = await openPanel(p, "Assess it myself now");
  await a.locator('[name="findings"]').fill("Main lift cylinder seal leaking.");
  await a.locator('[name="quoteRequired"]').selectOption("yes");
  await a.getByRole("button", { name: "Submit assessment" }).click();
  const cap = await openPanel(p, "Capture a quote received by email");
  await cap.locator('[name="contractorId"]').selectOption({ label: "LiftRight Forklifts – Refrigeration" });
  await cap.locator('[name="scope"]').fill("Reseal main lift cylinder.");
  await cap.locator('[name="price"]').fill("18 500");
  await cap.getByRole("button", { name: "Save quote" }).click();
  await expect(status(p)).toHaveText("Getting quotes");
  await expect(p.getByTestId("quote-rules")).toContainText("3 quotes needed above R 10 000.00");
  const choose = p.getByTestId("choose-LiftRight Forklifts");
  await choose.locator("summary").click();
  await expect(choose.locator('[name="exceptionReason"]')).toHaveAttribute("required", "");
  await choose.locator('[name="exceptionReason"]').fill("Only authorised dealer for this forklift model.");
  await choose.getByRole("button", { name: "Approve and appoint contractor" }).click();
  await expect(status(p)).toHaveText("Assigned");
  await gotoReady(p, jobUrl);
  await expect(p.getByTestId("timeline")).toContainText("Only authorised dealer");
});

test("10 · technician on a phone: bottom navigation, alerts, and opening the job clears its alert", async ({ browser }) => {
  const { p } = await company(browser);
    const tech = await acceptInvite(browser, await invite(p, `tech-${uid()}@e2e.example`, "Tumi Tech", ["TECHNICIAN"]), true);
  const nav = tech.getByRole("navigation", { name: "Mobile" });
  await expect(nav.getByRole("link")).toHaveText([/My jobs/, /Report fault/, /Alerts/, /Profile/]);

  const jobUrl = await logRequest(p, "Generator will not start");
  const send = await openPanel(p, "Send for assessment");
  await send.locator('[name="assessorId"]').selectOption({ label: "Tumi Tech" });
  await send.getByRole("button", { name: "Send for assessment" }).click();
  await expect(p.locator(".badge").first()).toHaveText("Awaiting assessment");

  await gotoReady(tech, "/my-jobs");
  await expect(tech.getByTestId("unread")).toHaveText("1");
  // With an unread alert showing, the header and nav must still pass WCAG 2.1 AA (e.g. "Alerts 1" names match).
  const a11y = await new AxeBuilder({ page: tech }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  await tech.getByText("Generator will not start").filter({ visible: true }).click();
  await expect(tech).toHaveURL(jobUrl);
  await expect(tech.getByTestId("next-action")).toContainText("Assess the problem");
  await gotoReady(tech, "/my-jobs");
  await expect(tech.getByTestId("unread")).toHaveCount(0);
});

test("11 · reports show defined metrics and the CSV export neutralises spreadsheet formulas", async ({ browser }) => {
  const { p } = await company(browser);
  await logRequest(p, '=HYPERLINK("http://evil.example","click")');
  await gotoReady(p, "/reports");
  for (const label of ["Faults reported", "Responded on time", "Contractor spend", "In-house vs contractor", "Reopened jobs", "Overdue jobs"]) await expect(p.getByText(label, { exact: true })).toBeVisible();
  await expect(p.getByText(/first response \(first move out of “New”\)/)).toBeVisible();
  const href = await p.getByRole("link", { name: "Download jobs (CSV)" }).getAttribute("href");
  const res = await p.request.get(href!);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv).toContain('"Reference","Title","Site"');
  expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
});

test("12 · owners can export all company data; other roles and visitors cannot", async ({ browser }) => {
  const { p, email } = await company(browser);
  await logRequest(p, "Export me");
  const res = await p.request.get("/api/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("manop-company-export");
  const body = await res.text();
  const data = JSON.parse(body);
  expect(data.format).toBe("fixrelay-export/2");
  expect(data.jobs.map((j: { title: string }) => j.title)).toContain("Export me");
  expect(body).not.toMatch(/passwordHash|tokenHash/);
  await gotoReady(p, "/settings");
  await expect(p.getByRole("link", { name: "Export all company data" })).toBeVisible();
  const anon = await newPage(browser);
  expect((await anon.request.get("/api/export")).status()).toBe(404);
  await gotoReady(p, "/jobs");
  await expect(p.getByText("Export me").filter({ visible: true })).toBeVisible();
  const history = await db.activityEvent.findFirst({ where: { type: "data.exported", orgId: (await db.membership.findFirstOrThrow({ where: { user: { email } } })).orgId }, orderBy: { createdAt: "desc" } });
  expect(history).not.toBeNull();
});

test("13 · rate limiting: repeated reset requests for one address are slowed down", async ({ browser }) => {
  const p = await newPage(browser);
  const email = `rl-${uid()}@e2e.example`;
  await gotoReady(p, "/forgot-password");
  for (let i = 0; i < 3; i++) {
    await f(p, "email").fill(email);
    await p.getByRole("button", { name: "Send reset link" }).click();
    await expect(p.getByText(/If that email address has a ManOp account/)).toBeVisible();
    await gotoReady(p, "/forgot-password");
  }
  await f(p, "email").fill(email);
  await p.getByRole("button", { name: "Send reset link" }).click();
  await expect(alertText(p)).toContainText("Too many attempts");
});

test("14 · accessibility: no WCAG 2.1 AA violations on the main screens, and nothing scrolls sideways on a phone", async ({ browser }) => {
  const { p } = await company(browser);
  const jobUrl = await logRequest(p, "Accessibility check job");
  const check = async (page: Page, url: string) => {
    await gotoReady(page, url);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => `${url}: ${v.id}`)).toEqual([]);
  };
  for (const u of ["/dashboard", jobUrl, `${jobUrl}/report`, "/requests/new", "/reports", "/settings", "/sites", "/contractors"]) await check(p, u);
  const m = await newPage(browser, { mobile: true });
  for (const u of ["/", "/login", "/register", "/forgot-password"]) await check(m, u);
  // On a phone nothing may scroll sideways (long action labels, tables), signed in or not.
  const phone = await newPage(browser, { mobile: true, storageState: await p.context().storageState() });
  for (const u of [jobUrl, "/dashboard", "/requests/new", "/sites", "/settings", "/contractors", "/reports", "/"]) {
    await gotoReady(phone, u);
    // Mobile browsers zoom out to fit wide content, so compare with the device width, not the (grown) layout width.
    expect(await phone.evaluate(() => document.documentElement.scrollWidth - screen.width), u).toBeLessThanOrEqual(0);
  }
});

test("15 · security: strict headers, hardened session cookie, minimal public health check", async ({ browser }) => {
  const p = await newPage(browser);
  const email = `sec-${uid()}@e2e.example`;
  await register(p, { email, company: `Sec ${uid()}` });
  const cookie = (await p.context().cookies()).find((c) => c.name.includes("fr_session"))!;
  expect(cookie.name).toBe("__Host-fr_session");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: true, path: "/" });
  const h = (await p.request.get("/dashboard")).headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(await (await p.request.get("/api/health")).json()).toEqual({ ok: true });
  // Forms must never fall back to GET (which would put passwords in the URL) if submitted before scripts load.
  const raw = await (await p.request.get("/login")).text();
  expect(raw).toMatch(/<form[^>]*method="post"/i);
  // Signing in again replaces the old session rather than keeping both.
  const before = await db.session.count({ where: { user: { email } } });
  await p.locator("aside").getByRole("button", { name: "Sign out" }).click();
  await gotoReady(p, "/login");
  await f(p, "email").fill(email);
  await f(p, "password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p).toHaveURL(/dashboard/);
  expect(await db.session.count({ where: { user: { email } } })).toBe(before);
});
