# Build status

Last updated: 2026-11-22 (Resultra release). Legend: **PASS** implemented and verified by executed tests or inspection · **PARTIAL** implemented with a stated limit · **FAIL** not working · **NOT TESTED** not verified.

## Resultra final acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Fix Relay is correctly renamed Resultra | PASS | All customer-facing text, metadata, manifest, emails, PDFs, legal pages and help; e2e features 1–2 (title, manifest), emails in tests. Technical identifiers kept on purpose (cookie, env vars, DB, Render service) – BRAND.md |
| 2 | The new icon is integrated | PASS | `public/brand/resultra-*.svg` (editable), favicon, Apple touch, PWA and maskable PNGs, social image, `Logo`/`Mark` components, PDF headers/footers, QR signs |
| 3 | Existing design and functionality preserved | PASS | Colours, typography and layout unchanged; all earlier tests still pass (94 Vitest, 37 earlier e2e) after updating only tests for intended changes (new QR links, optional phone, demo bar) |
| 4 | QR reporting works without login | PASS | S8, S9, journey 3, R13, R16; `qr.test.ts` |
| 5 | Correct site and area identification | PASS | Short codes per site/area/machine resolve to the right place (S8, `qr.test.ts`); old links still resolve until replaced |
| 6 | Employee registration and approval work | PASS | S5, S6, `registration.test.ts` |
| 7 | Department assignment and handovers work | PASS | S7, S12, `departments.test.ts` |
| 8 | Email notification links are correct | PASS | S13 (link → sign in → job), `departments.test.ts` (link in body); live delivery: see #22 |
| 9 | Managers can oversee job progress | PASS | Dashboard tiles incl. unassigned, duplicates, reopened, completed; department filter; board (B1); S10 |
| 10 | Duplicate reports can be reviewed | PASS | S10, `departments.test.ts` |
| 11 | Closed jobs can be reopened | PASS | S18, journey 1 |
| 12 | Active job cards can be viewed, printed and downloaded | PARTIAL | Viewing and downloading are verified (D1, D2, D7). Print: the Print button calls the browser's print on the framed PDF (falls back to opening it in a new tab), and every PDF is print-ready A4; the browser print dialog itself cannot be driven by the headless test browser and was **not tested** |
| 13 | Job-card PDFs use the correct Resultra design | PASS | Visual inspection of rendered pages; header/footer/brand text asserted in `documents.test.ts`, D2 |
| 14 | Reported photographs appear correctly | PASS | Image count and proportions (`documents.test.ts`, D3); visual check: no stretching or cropping |
| 15 | Completed job reports work | PASS | D4, S20, `documents.test.ts` |
| 16 | Job history is preserved | PASS | Append-only audit tables (trigger tests), handover append-only test, history PDF (S20, `documents.test.ts`) |
| 17 | Platform administration is functional | PASS | S1, S2, S4, `platform-demo.test.ts`; PLATFORM_ADMIN_GUIDE |
| 18 | Demo data is isolated | PASS | Separate demo companies, synthetic data, no email (`platform-demo.test.ts`), view-as limited to demo (forged-session test), V1 |
| 19 | Automated tests are executed | PASS | 94/94 Vitest, 65/65 Playwright (TESTING.md) |
| 20 | Critical security defects are resolved | PASS | No known critical defects; production `npm audit` 0; isolation tests (S19, security suite); dev-only tool advisories listed in TESTING.md. An independent penetration test is still recommended |
| 21 | Screenshot-based documentation is created | PASS | `docs/RESULTRA_USER_GUIDE.pdf` (17 pp), `RESULTRA_SITE_ADMIN_GUIDE.pdf` (12 pp), `RESULTRA_PLATFORM_ADMIN_GUIDE.pdf` (6 pp), `RESULTRA_PILOT_TESTING_GUIDE.pdf` (3 pp), screenshots in `docs/screenshots`, rebuilt by `scripts/guides/*` |
| 22 | Render and Resend setup instructions are complete | PARTIAL | DEPLOYMENT.md has the full steps (Render Blueprint, PDFs without a browser, files in Postgres, custom domain/HTTPS, backups, monitoring, Resend domain/DNS/key/sender). Not done from here: buying the Resultra domain, verifying it in Resend, and a live delivery test on it |
| 23 | Deployed and smoke-tested | PASS | Render demo redeployed from this branch (commit `7150ac2`); live smoke test passed (TESTING.md). The demo runs on Render's free tier; move to the paid Blueprint for the pilot |

## Resultra features delivered

| Area | Status | Notes |
|---|---|---|
| Existing system audit + checkpoint | PASS | EXISTING_SYSTEM_AUDIT.md; checkpoint commit `f3da29a` |
| Branded PDF documents (job card, completion report, history, QR signs) | PASS | PDF_DOCUMENTATION.md |
| Departments, department managers, handovers | PASS | |
| Employee self-registration with codes and approval | PASS | Profile photo optional; stored privately |
| QR: short codes, optional contact, double-submit guard, spam trap, safety notice | PASS | |
| Duplicate review and repeat faults | PASS | Rule-based, never automatic merging |
| Dashboard additions and department filter | PASS | |
| Email links and return after sign-in | PASS | |
| Platform admin | PASS | Account metadata only; companies list limited to newest 50 + search |
| Demo personas, view as, reset, no email | PASS | Reset archives (append-only audit rows are never deleted) |
| Pilot environment | PARTIAL | Pilot companies are created in Platform admin; a separate staging service is documented but was not provisioned from here |

## Deferred features and next priorities
1. Provision the paid Render Blueprint (the free demo database expires 2026-12-17), buy and connect the domain, verify Resend, live email test.
2. Usability sessions with real site staff using the pilot guide; fix wording and flow issues found.
3. Independent security review / penetration test; nonce-based CSP.
4. Upgrade vitest (dev-only advisories) and build the Docker image once.
5. Possible next features (only if pilot feedback asks): scheduled preventive maintenance, push notifications, offline data entry, customer-specific document logos on PDFs.

## Earlier: internal site maintenance model (2026-11-17)

Resultra was changed from a tool for maintenance *contractors serving customers* into an **internal maintenance system for a company's own sites**. Defaults chosen (the plan's recommendations): several sites per subscriber; spending limits by amount with optional PO numbers; three quotes above a limit the company sets (or a written reason); the reporter confirms the fix and the manager closes; reporting without an account behind a setting (off by default); this replaces the contractor-facing version.

| # | Criterion (internal model) | Status | Evidence |
|---|---|---|---|
| 1 | Company can create an account and complete onboarding | ✅ | e2e journey 1, features 1/4; checklist computed from real records |
| 2 | Company data is securely separated | ✅ | integration isolation suite; e2e journey 4; composite FKs |
| 3 | Users can be invited with roles and site limits | ✅ | e2e journeys 1–2, feature 10; integration (site-limited member) |
| 4 | Sites, locations and equipment can be created; QR codes printed | ✅ | e2e journeys 1, 3 |
| 5 | Someone on site can report a fault with evidence (app or QR, optionally without an account) | ✅ | e2e journeys 1, 3; feature 8 (GPS stripped) |
| 6 | An assessment can be recorded | ✅ | e2e journey 1 (technician on a phone) |
| 7 | The job can be fixed in-house | ✅ | e2e journey 1 |
| 8 | Contractors can quote by secure link, quotes can be captured and compared | ✅ | e2e journey 2, feature 9; integration |
| 9 | Spend is approved by the right person for the amount, with PO and three-quote rules | ✅ | e2e journey 2, feature 9; integration (limits, approver limits, concurrency) |
| 10 | Technician or contractor records work and evidence | ✅ | e2e journeys 1–2 |
| 11 | The reporter confirms it is fixed (or a manager with a reason / signature) | ✅ | e2e journeys 1–2; integration |
| 12 | Job can be closed or reopened appropriately | ✅ | e2e journey 1; integration (contractor rework link) |
| 13 | Complete audit history | ✅ | e2e timeline/report; DB trigger |
| 14 | Main workflow passes meaningful automated tests | ✅ | 76 integration/unit + 37 e2e, all green |
| 18 | Priority when reporting (app and QR); Open now / History board with priority chips and photo cards | ✅ | e2e B1, R1, R16; `spares.test.ts` |
| 19 | Spares at assessment; stores and managers notified; stores issue / order / receive; Stores role | ✅ | e2e B2; `spares.test.ts` |
| 17 | Guided (step-by-step) report and completion forms; area reports and area CSV | ✅ | e2e R1–R15 |
| 16 | Paper maintenance work requisition replaced by a digital, signed form | ✅ | Every line of the paper form (number, dates/times, area, projects, description, submitted by/to, start, report, food-area check, root cause, completed, originator and manager confirmation) filled in and signed; e2e journey 1, `requisition.test.ts`; print/PDF fits one A4 page |
| 15 | Installed, configured and deployed using the documentation | ✅ | Live demo https://fixrelay-demo.onrender.com redeployed from this branch (migrations ran on start); live smoke test passed (TESTING.md). Pushes do not trigger deploys on this service (GitHub webhook not connected): deploy from the Render dashboard or API |

## Previously open gaps (this round)

| Gap | Status | Notes |
|---|---|---|
| Forgot password / email verification | ✅ | Hashed single-use tokens; unverified users cannot email others; e2e 4–6 |
| Real email provider | ✅ | **Live Resend delivery verified** (test email via the app's transport, plus the live demo's confirmation email); SMTP proven against a real SMTP server |
| Files on one server's disk | ✅ | Default `db` storage (multi-instance); `s3` driver tested with an S3-compatible server |
| Rate limit per server | ✅ | Postgres-backed, atomic, concurrency-tested; client IP read safely behind proxies |
| Antivirus | ✅ | ClamAV INSTREAM, fails closed; proven with a real clamd. PDF scripts blocked |
| Photo location data | ✅ | All metadata stripped by re-encoding; e2e 8 |
| Security / POPIA review | 🟡 | Self-audits (AUDITS.md) and POPIA.md engineering review done. **An independent security test and legal review are still needed** |
| Deployment | ✅ | Live free demo on Render (see criterion 16). Production needs the paid `render.yaml` and the reviews below |

## Modules
| Area | Status | Notes |
|---|---|---|
| Auth, sessions, reset, verification | ✅ | MFA ❌ (roadmap) |
| Multi-tenancy, roles, site scoping, approval limits | ✅ | |
| Sites/locations/equipment, QR codes, public reporting | ✅ | QR scanning with a real phone camera not tested |
| Contractor directory, secure quote/completion links | ✅ | No contractor accounts (by design) |
| Fault → assessment → in-house or contractor quotes → approval → work → confirmed fixed → closure | ✅ | |
| Audit trail, job report | ✅ | PDF via browser print |
| Notifications (in-app + email outbox + worker) | ✅ | In-process worker option |
| Dashboard and insights (spend by site/equipment, in-house vs contractor, contractor performance, approval turnaround, CSV) | ✅ | |
| Subscriptions, operator console, support access | ✅ / 🟡 | No payment provider (by design) |
| Data export (company) and retention | ✅ | Automated anonymisation ❌ |
| Branding, landing page, PWA | ✅ / 🟡 | Not tested on physical phones; no offline data entry |
| Accessibility | ✅ | 0 axe WCAG 2.1 AA violations (19 pages × 2 sizes) |

## Known limitations
1. After a successful form action the page reloads (deliberate; see AI_HANDOVER.md "Next.js caveats").
2. Form fields are read-only for the moment before the page becomes interactive (prevents lost typing).
3. CSP allows inline scripts (needed by Next.js without nonces).
4. Timezone display fixed to Africa/Johannesburg.
5. Antivirus only runs when `CLAMAV_HOST`/`CLAMAV_SOCKET` is configured.
6. Quotes are a single price per contractor (with a document attached), not itemised lines; there is no purchase-order document generation (only the PO number).
7. Public QR reporting relies on rate limits and manager screening against spam; there is no CAPTCHA.
8. The earlier contractor-facing features (customer records, customer review links, customer portal) were removed in this version.
