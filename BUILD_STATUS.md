# Build status

Last updated: 2026-11-17. Legend: ✅ implemented and tested · 🟡 implemented, partly tested or with known limits · ❌ not started

## Final acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Company can create an account and complete onboarding | ✅ | e2e journey and feature 1/4; checklist computed from real records |
| 2 | Company data is securely separated | ✅ | integration isolation suite; e2e rival company; composite FKs |
| 3 | Users can be invited and assigned roles | ✅ | e2e journey, 9, 10; integration |
| 4 | A client and site can be created | ✅ | e2e |
| 5 | A request can be logged with evidence | ✅ | e2e (photos, GPS stripped) |
| 6 | An assessment can be recorded | ✅ | e2e |
| 7 | A valid quotation can be produced and reviewed | ✅ | e2e (VAT totals), unit money tests |
| 8 | Authorised customers can approve or reject | ✅ | e2e link and portal; integration concurrency and forgery |
| 9 | An approved job can be assigned | ✅ | e2e |
| 10 | Technician records work and evidence | ✅ | e2e |
| 11 | Completion can be submitted for verification | ✅ | e2e |
| 12 | Authorised customer can approve completed work | ✅ | e2e (link + signature), integration |
| 13 | Job can be closed or reopened appropriately | ✅ | e2e plus integration |
| 14 | Complete audit history | ✅ | e2e timeline/report; DB trigger |
| 15 | Main workflow passes meaningful automated tests | ✅ | 68 integration/unit + 18 e2e, all green |
| 16 | Installed, configured and deployed using the documentation | ✅ | Fresh clone from the docs verified, and **deployed live from `render.demo.yaml`: https://fixrelay-demo.onrender.com** (2026-11-17). The live smoke test passed (landing, PWA, headers, sign-up, `__Host-` cookie, demo workspace) and the live confirmation email was **delivered via Resend**. The Dockerfile and docker-compose are still not built (no Docker in the sandbox) |

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
| Multi-tenancy, roles, customer scoping | ✅ | |
| Customers/sites/locations/assets | ✅ | |
| Requests → assessment → quote → approval → assignment → execution → completion → closure | ✅ | |
| Audit trail, job report | ✅ | PDF via browser print |
| Notifications (in-app + email outbox + worker) | ✅ | In-process worker option |
| Dashboard and reports (incl. response time, win rate, rework, CSV) | ✅ | |
| Subscriptions, operator console, support access | ✅ / 🟡 | No payment provider (by design) |
| Data export (company, customer) and retention | ✅ | Automated anonymisation ❌ |
| Branding, landing page, PWA | ✅ / 🟡 | Not tested on physical phones; no offline data entry |
| Accessibility | ✅ | 0 axe WCAG 2.1 AA violations (19 pages × 2 sizes) |

## Known limitations
1. After a successful form action the page reloads (deliberate; see AI_HANDOVER.md "Next.js caveats").
2. Form fields are read-only for the moment before the page becomes interactive (prevents lost typing).
3. CSP allows inline scripts (needed by Next.js without nonces).
4. Timezone display fixed to Africa/Johannesburg.
5. Antivirus only runs when `CLAMAV_HOST`/`CLAMAV_SOCKET` is configured.
