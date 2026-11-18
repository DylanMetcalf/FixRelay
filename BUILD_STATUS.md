# Build status

Last updated: 2026-11-17. Legend: ✅ implemented and tested · 🟡 implemented, partly tested or with known limits · ❌ not started

## Internal site maintenance model (2026-11-17)

FixRelay was changed from a tool for maintenance *contractors serving customers* into an **internal maintenance system for a company's own sites**. Defaults chosen (the plan's recommendations): several sites per subscriber; spending limits by amount with optional PO numbers; three quotes above a limit the company sets (or a written reason); the reporter confirms the fix and the manager closes; reporting without an account behind a setting (off by default); this replaces the contractor-facing version.

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
| 14 | Main workflow passes meaningful automated tests | ✅ | 71 integration/unit + 19 e2e, all green |
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
