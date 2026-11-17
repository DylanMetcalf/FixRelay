# Testing

## Strategy

| Layer | Tool | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Money parsing and rounding, VAT, the state machine, next-action, rate limiter | `tests/unit/` |
| Integration | Vitest + **real PostgreSQL** (`fixrelay_test`) | Services called directly: full workflow, alternatives, concurrency, security, notifications, subscriptions | `tests/integration/` |
| End-to-end | Playwright (Chromium) against a **production build** | The real UI in desktop and phone viewports, across several browser contexts (owner, technician, customer, rival company) | `e2e/` |

Integration tests do not mock the database. Each test creates its own tenant(s) with unique names, so tests are independent and the shared test DB also exercises isolation. `tests/global-setup.ts` runs `prisma migrate deploy` (non-destructive) and refuses any database whose name does not contain `test`.

## Commands

```bash
npm test                          # unit + integration (needs Postgres and TEST_DATABASE_URL, default fixrelay_test)
```

```bash
npm run build && npm run test:e2e # starts `next start -p 3100` against the test DB, runs Playwright
```

```bash
npm run typecheck
```

## Results (last run: 2026-11-17, Linux, Node 22, PostgreSQL 16.15, Chromium from Playwright 1.63, ClamAV 1.5.4)

- `npm run typecheck`: **pass**
- `npm test` (with `CLAMAV_TEST_PORT=3310`): **68 / 68 passed**, 6 files, run twice in a row
- `npm run test:e2e`: **18 / 18 passed** (3 journey tests plus 15 feature tests), run twice in a row, about 70s
- `npm run build`: **pass**
- Fresh-clone install from README/DEPLOYMENT (empty database → migrate → seed → build → start with in-process worker → sign up → confirmation email delivered): **pass**
- **Live deployment** (https://fixrelay-demo.onrender.com): smoke test passed (landing, manifest, service worker, CSP/HSTS, sign-up, `__Host-` cookie, demo workspace). The live sign-up confirmation email was **delivered** (Resend status), and a direct Resend transport test was also delivered
- axe-core WCAG 2.1 AA: **0 violations** on 19 pages at desktop and phone sizes (also enforced by e2e test 14)

### Real services used in tests
| Capability | Tested against |
|---|---|
| Antivirus | **Real ClamAV daemon** (clamd INSTREAM over TCP). The official signature download is blocked in the sandbox, so a custom EICAR body signature (`/var/lib/clamav/fixrelay-test.ndb`) was loaded; production uses `freshclam` |
| Email (SMTP) | **Real SMTP server** (`smtp-server`), with AUTH, multipart text + HTML, and a wrong-password failure |
| Email (Resend) | Local HTTP stand-in that checks the exact request, **and live Resend delivery** (2026-11-17) |
| File storage (S3) | `s3rver` (S3-compatible API) with a 3 MB object round trip; not AWS/R2 itself |
| Rate limiter | Real Postgres, 12 concurrent requests |
| Photo metadata | Real JPEG with GPS + camera EXIF and rotation, decoded after upload |

To run the ClamAV test locally: install `clamav-daemon`, start `clamd` on 127.0.0.1:3310 with real signatures (or the EICAR test signature), then `CLAMAV_TEST_PORT=3310 npm test`. Without it, that one test is skipped and reported as skipped.

### Playwright feature tests (e2e/features.spec.ts)
1 landing page → sign-up, signed-in users skip it, legal pages · 2 PWA manifest, icons, shortcuts, screenshots, active service worker · 3 offline page; nothing tenant-specific cached; first visit does not reload · 4 email confirmation gate and unlock · 5 forgot password (no enumeration, single use, input kept on error, old password rejected) · 6 bogus/expired links explained · 7 show/hide password · 8 photo GPS stripped and PDF scripts refused through the UI · 9 customer rep "Needs your decision" → portal approval · 10 technician on a phone: bottom nav, alert badge, opening the job clears it · 11 report metrics with definitions; CSV formula-injection safe · 12 company data export (no secrets; others refused; audited) · 13 rate limiting · 14 axe WCAG 2.1 AA on main screens (desktop and phone) · 15 security headers, `__Host-` cookie, minimal health, session rotation, forms never GET

## Known gaps in testing (honest list)

- No load or performance tests. Reports aggregate in application code (capped at 5,000 rows per query).
- Email has not been sent through a live provider account (SMTP verified against a real SMTP server, Resend against a stand-in).
- PWA installability was verified by manifest, icon and service-worker checks in Chromium, not by installing on a physical iOS/Android device. **Offline data entry is not supported**: the service worker shows an offline page.
- Only Chromium was used for e2e (no Safari/WebKit or Firefox runs).
- The Dockerfile and docker-compose were not built (no Docker in the sandbox).
- Not every page has an e2e test (asset pages, platform console UI, settings for priority rules and support grants are covered by service tests only).

## Failures found and fixed during development (for future reference)

1. **Prisma nested create with a composite FK** failed when copying quote lines on revision → changed to `createMany` (`quotes.ts`).
2. **Forms stuck on "Working…" / pages not updating in production builds** (Next 15.5.29): server-action responses that triggered `revalidatePath`/`redirect`, and later `router.refresh()` RSC fetches, were intermittently cancelled in the browser (`net::ERR_ABORTED`). Fixed by returning `redirectTo` and doing a full page navigation or reload after success, with a flash message (`src/components/form.tsx`). See AI_HANDOVER.md.
3. **React 19 cleared form fields after a failed action**, so users lost their input on validation errors → forms now submit through `startTransition` instead of the `action` prop.
4. **Denied job pages returned HTTP 200** (with not-found content) because a `loading.tsx` streaming boundary flushed headers first → boundary removed; denied pages now return 404.
5. Accepting an invitation unmounted its own form (the re-render showed "invalid") → the invite page now sends a signed-in visitor to the dashboard.

### Found by the second round (audits and the 15 new Playwright tests), all fixed
6. Rate limiting trusted a client-supplied `X-Forwarded-For` value (bypass) → trusted-proxy hop count.
7. The service worker reloaded the page on **first install**, wiping what a first-time visitor was typing (for example on an invitation link) → reload only after the user taps "Update".
8. React 19 replaced values typed **before hydration** (slow phones) → fields are read-only until the page is interactive (verified with throttled scripts).
9. A form submitted before scripts loaded could fall back to **GET with the password in the URL** → forms always have a native POST target, and buttons are disabled until ready.
10. On desktop only the job reference was clickable, not the title → title linked.
11. Accessibility: header button name mismatch, an invalid definition list, low-contrast text → fixed (0 violations).
