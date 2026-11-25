# Testing

## Strategy

| Layer | Tool | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Money parsing and rounding, VAT, the state machine, next-action per route, client IP parsing | `tests/unit/` |
| Integration | Vitest + **real PostgreSQL** (`fixrelay_test`) | Services called directly: in-house and contractor routes, approvals by limit, three-quote and PO rules, contractor links, public reporting, concurrency, security, notifications, subscriptions | `tests/integration/` |
| End-to-end | Playwright (Chromium) against a **production build** | The real UI in desktop and phone viewports, across several browser contexts (owner, manager, approver, technician, fault reporter, two contractors without accounts, an anonymous QR reporter, a rival company) | `e2e/` |

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

## Results (last run: 2026-11-22, ManOp release; Linux, Node 22, PostgreSQL 16, Chromium from Playwright 1.63, ClamAV 1.5.4)

- `npm run typecheck`: **pass**
- `npm test` (with `CLAMAV_TEST_PORT=3310`): **94 / 94 passed**, 13 files. New: `documents.test.ts` (5: job card content, A4, multi-page, photos, footer link, completion rules, history and price permissions, isolation), `departments.test.ts` (5: departments, department scope, handover record and notifications, duplicate scoring, flag/link/dismiss, repeat faults, double submit), `registration.test.ts` (2: codes, pending requests, email confirmation, approval, decline, expiry, replacement), `qr.test.ts` (3: short codes, legacy links, rotation, name-only and idempotent QR reports, QR sign PDF), `platform-demo.test.ts` (3: customer creation and invitation, account-metadata overview, demo personas, no demo email, view-as restrictions, reset).
- `npm run test:e2e`: **65 / 65 passed** (15 features, 4 journeys, 16 requisition, 2 board/spares, **28 in `e2e/manop.spec.ts`**). In the last complete run 62 passed, 2 failed because they still used the pre-upgrade QR link format, and 1 did not run because it depends on an earlier test in the same serial file; after updating the two tests, those 3 were re-run and passed (`journey.spec.ts` 4/4, R16).
- `npm run build`: **pass**
- `npm audit --omit=dev`: **0 vulnerabilities**. `npm audit` (including dev tools) lists advisories in `vitest`/`tinypool`/`@vitest/mocker` and `s3rver` (`busboy`/`dicer`, `fast-xml-parser`): these are test-only tools that never ship to production; fixing them needs a vitest major upgrade (follow-up). `effect` (Prisma CLI) is pinned to 3.22.4 for GHSA-7589-6fvf-x4pw.
- `prisma migrate diff` (migrations vs schema): **no drift**
- **Live smoke test** (https://fixrelay-demo.onrender.com, commit `7150ac2`, 2026-11-22): title and heading "ManOp – From reported to resolved.", manifest and icon, sign-up, demo workspace with demo bar, job card PDF download (`MANOP_JobCard_12602.pdf`, application/pdf), history PDF, short site link `/r/<code>`, QR signs PDF, "view as" the finance approver, and an anonymous phone report through the QR link with the demo's required signature (report number shown). Static files were routed through Playwright's network stack because of a sandbox network quirk (see earlier notes).
- PDFs: generated documents were checked with pdf.js in tests and rendered to images with `pdftoppm` for visual inspection (layout, page breaks, photo proportions, footer on every page).

### The 20 required pilot scenarios (e2e/manop.spec.ts)

| # | Scenario | Test | Result |
|---|---|---|---|
| 1 | Platform administrator login | S1 (lands on /platform; others are refused) | Pass |
| 2 | Customer company creation | S2 (trial, site, departments, listed) | Pass |
| 3 | Site creation | S3 (short QR link, QR signs PDF) + journey 1 | Pass |
| 4 | Site administrator invitation | S4 (invitation email → accept → administrator tools; platform shows contact joined) | Pass |
| 5 | Employee registration | S5 (code → pending; no company pages; bad code refused) | Pass |
| 6 | Employee approval | S6 (approval blocked until email confirmed; role + department; profile prefilled) | Pass |
| 7 | Department permissions | S7 (department manager sees own department's job, 404 on another's) | Pass |
| 8 | Public QR reporting | S8 (area code, name only, photo) + journey 3, R13, R16 | Pass |
| 9 | Incorrect or abusive public submissions | S9 (bad link, empty description, short phone, disguised file, spam trap, HTML shown as text) | Pass |
| 10 | Duplicate report handling | S10 (flag, dashboard tile, link, original keeps the record) | Pass |
| 11 | Maintenance request triage | S11 (urgency change, send for assessment) | Pass |
| 12 | Department handover | S12 (reason, department change, timeline, record) | Pass |
| 13 | Email notification link behaviour | S13 (email link → sign in → same job; external `next` refused) | Pass |
| 14 | Quotation workflow | S14 (capture quote, approve within limit, contractor appointed, VAT) + journey 2 | Pass |
| 15 | Technician job execution | S15 (phone: start work, progress note) | Pass |
| 16 | Completion evidence submission | S16 (after photo, root cause) | Pass |
| 17 | Verification and closure | S17 (reporter confirms, manager closes) | Pass |
| 18 | Reopening a closed job | S18 (reason, closure kept, repeat fault linked) | Pass |
| 19 | Cross-customer data isolation | S19 (pages, PDFs, files, photos, QR signs) + journey 4 | Pass |
| 20 | Full maintenance lifecycle | S20 (report with photo → close → all three PDFs) + journey 1 | Pass |

### Job document tests
D1 document buttons and in-app viewer (frame source is a same-origin PDF) · D2 downloaded job card: A4, file name, headers, company/site/job data, status, generation time · D3 photo rendering and multi-page flow with footers · D4 completion report after closure · D5 permissions (401/403/404/409) · D6 the QR/link on a card opens the job only after sign-in · D7 phone layout. V1 covers the demo "view as" flow.

### What the browser journeys cover (e2e/journey.spec.ts)
1. **In-house, with the digital requisition**: register → confirm email → add a site with locations → set requisition numbering to 12600 and require signatures → invite a technician and a fault reporter (phone) → the reporter reports a fault with a photo → the manager sends it for assessment → the technician assesses on a phone (no prices shown) → "Fix it in-house" → assign → start, log time → finishing without an after-photo is refused → the reporter answers "Is it fixed?" from their dashboard → the manager cannot close before that → every step signed on screen (submitted by, received by maintenance, completed by with a root cause, confirmed by originator, signed off by the manager) → the filled-in requisition shows number 12600, each line, the ticked root cause and all five signature images → Insights count → reopen with a reason.
2. **Contractor + approvals**: the owner sets approval rules (manager R 5 000, PO required, 2 quotes above R 10 000) → invites a manager and a finance approver → adds a VAT-registered and a non-VAT contractor → the manager logs and assesses a fault → requests quotes from both → each contractor opens their emailed link on their own device (the requested scope is shown) and quotes (VAT only on the registered one) → side-by-side comparison, cheapest marked → R 6 900 is over the manager's limit → "Send for approval" → the approver sees it under "Needs your approval" and approves with a PO → the other contractor's link shows "closed" and they get a "not selected" email → the winner gets an appointment link, submits completion with a photo (single use) → the operator signs on the manager's device → close → contractor performance on Insights.
3. **QR reporting without an account**: off by default (the QR link asks for sign-in) → switched on → QR label sheet (site + each location) → an anonymous phone scans a location code: location pre-filled → report sent, reference shown → "Public reports to screen" on the dashboard → the reporter's details on the job → "Replace link" makes the old QR codes stop working.
4. **Permissions and tenancy**: technicians are refused settings, quotes, insights, contractors and the platform console; a fault reporter gets 404 on someone else's job and doesn't see it in lists; signed-out visitors are sent to sign in and files are not served; bogus and closed contractor links explain themselves; a second company gets 404 on the first company's jobs, files, reports and sites.

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

### Requisition tests (e2e/requisition.spec.ts)
R1 guided report: steps checked, Back keeps answers, Edit from the review · R2 Enter moves to the next step, never sends early · R3 numbering continues a paper book, never goes backwards · R4 signatures optional by default, empty lines on the form · R5 required signature enforced, Clear works · R6 food-area tools/clean question and Y/N on the form · R7 Projects box on job and form · R8 job page tracks each section, highlights next · R9 printed requisition fits one A4 page · R10 most-affected areas → area history, root causes, pre-filled report · R11 area CSV only that area, with root causes and Projects · R12 Insights narrowed to one area · R13 no-account QR report: details checked, shown in the review and on the form · R14 demo: fully signed requisition, area history, numbers from 12600 · R15 technician's guided completion on a phone fits the screen and shows the review · R16 anyone with a phone (emulated iPhone): the simple QR report never zooms on tap (all fields ≥16px), has no sideways scroll, ≥44px tap targets, passes WCAG 2.1 AA on every step, keeps pinch-zoom available, and delivers the title, place and photo to maintenance

### Playwright feature tests (e2e/features.spec.ts)
1 landing page → sign-up, signed-in users skip it, legal pages · 2 PWA manifest, icons, shortcuts, screenshots, active service worker · 3 offline page; nothing tenant-specific cached; first visit does not reload · 4 email confirmation gate and unlock · 5 forgot password (no enumeration, single use, input kept on error, old password rejected) · 6 bogus/expired links explained · 7 show/hide password · 8 photo GPS stripped and PDF scripts refused through the UI · 9 three-quote rule: approving with fewer quotes above the threshold needs a written reason, which is kept in the history (quote captured from an email) · 10 technician on a phone: bottom nav, alert badge, opening the job clears it · 11 report metrics with definitions; CSV formula-injection safe · 12 company data export (no secrets; others refused; audited) · 13 rate limiting · 14 axe WCAG 2.1 AA on main screens (desktop and phone) · 15 security headers, `__Host-` cookie, minimal health, session rotation, forms never GET

## Known gaps in testing (honest list)

- Automated tests do not replace real usability testing with site staff or an independent security review.
- The QR image inside PDFs is checked through its link annotation, not by decoding the image.
- Live email delivery through Resend was not exercised from the sandbox in this release (transport tested against an HTTP stand-in; the earlier demo deployment delivered through Resend).
- Docker images were not built (no Docker in the sandbox).

- No load or performance tests. Reports aggregate in application code (capped at 5,000 rows per query).
- PWA installability was verified by manifest, icon and service-worker checks in Chromium, not by installing on a physical iOS/Android device. **Offline data entry is not supported**: the service worker shows an offline page.
- Only Chromium was used for e2e (no Safari/WebKit or Firefox runs).
- The Dockerfile and docker-compose were not built (no Docker in the sandbox).
- Not every page has an e2e test (equipment pages, contractor edit page, platform console UI, priority rules and support grants are covered by service tests only).
- Printed QR labels were checked on screen; scanning a printed label with a real phone camera was not tested.

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

### Found while rewriting the browser tests for the internal site model, all fixed
12. A quote already received by email could only be captured after sending link requests → "Capture a quote received by email" now also works straight from "Assessed".
13. The contractor's link page did not show the work the manager asked them to quote for (it was only in the email) → stored on the link and shown at the top of the page.
14. After a contractor submitted a quote or completion the page kept the filled form with a small message, inviting duplicate submissions → the page reloads and shows their submitted quote / "completion received".
15. Money values in the quote comparison wrapped onto two lines → no wrapping.
16. Location chips showed a bare job count ("Cold Room 2 · 0") → the count is shown only when there are jobs ("· 2 jobs").
