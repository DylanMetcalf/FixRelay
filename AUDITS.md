# Self-audits (2026-11-17)

Five structured passes over the product after the production-gap work. Each pass used a single lens, recorded findings with severity, fixed them, and verified the fix. These audits were performed by the same engineer (AI) who wrote the code. **An independent human security review and penetration test are still recommended before launch.**

Severity: High = exploitable or blocks a core task · Medium = real risk or friction · Low = hardening or polish.

## Audit 1: Security and POPIA

| # | Finding | Sev. | Fix | Evidence |
|---|---|---|---|---|
| 1.1 | Rate limiting used the **leftmost** `X-Forwarded-For` value, which clients control, so every limit (login, sign-up, reset, links) could be bypassed by sending a fake header | **High** | Use the entry `TRUSTED_PROXY_HOPS` from the right (default 1) (`ipFromHeaders`) | `tests/unit/ip.test.ts` |
| 1.2 | Rate limiter was in-memory (per instance) | High | Postgres-backed atomic UPSERT limiter | `production.test.ts` "shared rate limiter" (12 concurrent hits → exactly 5 allowed) |
| 1.3 | No password reset or email verification | High | Single-use hashed tokens (60 min / 48 h), no account enumeration, reset signs out all devices, unverified users cannot email others | `production.test.ts` "password reset", "email verification" |
| 1.4 | No script/connect Content-Security-Policy | Medium | `default-src 'self'` policy restricting scripts, requests, images and fonts to this site | e2e header test |
| 1.5 | Uploads not virus-scanned; photos kept GPS/EXIF | Medium | ClamAV INSTREAM (fails closed), PDF active-content block, image re-encode strips all metadata | `production.test.ts` (real clamd + EICAR, EXIF test) |
| 1.6 | Session cookie lacked the `__Host-` prefix | Low | `__Host-fr_session` in production | — |
| 1.7 | Signing in kept the pre-existing session alive | Low | Old session deleted on sign-in | — |
| 1.8 | Health endpoint would expose platform-wide email volume | Low | Details only with `HEALTH_TOKEN` | — |
| 1.9 | Sign-up reveals that an email is registered | Low | **Accepted:** needed for usable sign-up, rate limited; reset flow does not reveal | — |
| 1.10 | No MFA for owners or the platform operator | Medium | **Open:** roadmap #1 after launch prerequisites | BUILD_STATUS.md |
| 1.11 | POPIA: no data export, retention or privacy notice | Medium | Company and per-customer JSON export (audited), retention purge, privacy/terms templates, POPIA.md | `production.test.ts` "retention" |

## Audit 2: UX, intuitiveness, copy

| # | Finding | Sev. | Fix |
|---|---|---|---|
| 2.1 | Client representatives had to hunt for quotes and work awaiting their approval | Medium | "Needs your decision" panel at the top of their dashboard with direct buttons |
| 2.2 | Opening a job did not clear its alerts, so the counter stayed high | Medium | Viewing a job marks its alerts read (per user) |
| 2.3 | Long passwords are hard to type on phones | Low | Show/Hide toggle on all password fields |
| 2.4 | Onboarding checklist did not mention the new email confirmation step | Low | "Confirm your email" added (computed from the account) |
| 2.5 | "Alerts" in navigation but "Notifications" on the page | Low | Consistent "Alerts" |
| 2.6 | No way to recover a forgotten password from the sign-in page | High | "Forgot password?" link and flow |

## Audit 3: Visual design and accessibility

Method: axe-core (WCAG 2.0/2.1 A and AA rules) on 19 pages at desktop (1280px) **and** phone (390px) sizes, plus screenshot review.

| # | Finding | Sev. | Fix |
|---|---|---|---|
| 3.1 | Header alerts button: accessible name "Notifications…" did not match visible "Alerts" (every app page) | Medium | Name now starts with the visible text |
| 3.2 | Assessment card used invalid `<dl>` content | Low | Badges moved outside the list |
| 3.3 | Small grey text on the landing page below contrast ratio | Low | Darker text, 11px minimum |
| 3.4 | On desktop, only the job reference was clickable; clicking the title (the natural target) did nothing | Medium | Title is a link as well |
| 3.5 | No product identity (generic icon, slate palette) | Medium | FixRelay mark, palette, logo component, branded auth/landing/offline pages, social image (BRAND.md) |

Result after fixes: **0 axe violations on all 19 pages at both sizes.**

## Audit 4: Functionality and workflow

| # | Finding | Sev. | Fix | Evidence |
|---|---|---|---|---|
| 4.1 | "Request clarification" was one-way: a manager's reply did not alert the technician | Medium | Manager notes on a job notify its technicians | `audits.test.ts` |
| 4.2 | Removing a technician silently left open jobs without a working lead | Medium | Owner is told how many open jobs to reassign | `audits.test.ts` |
| 4.3 | Customer-facing emails had no reply path to the company | Low | Reply-To set to the company's contact email | `production.test.ts` outbox test |
| 4.4 | Emails were plain text and unbranded | Low | Branded HTML with the company's colour and a clear button | `production.test.ts` |
| 4.5 | Worker required a second process, which is costly for small deployments | Low | `WORKER_IN_PROCESS=true` option | — |

## Audit 5: Reporting and operations

| # | Finding | Sev. | Fix | Evidence |
|---|---|---|---|---|
| 5.1 | Response-time targets per priority were configured but never measured | Medium | `Job.respondedAt` and a "Responded on time" metric with definition | `audits.test.ts` |
| 5.2 | No commercial outcome metrics | Medium | Quote win rate (count and value) and reopened-job (rework) rate | `audits.test.ts` |
| 5.3 | No way to analyse jobs in a spreadsheet | Medium | Jobs CSV download (formula-injection safe) | e2e CSV test |
| 5.4 | Monitoring could not see stuck email | Low | Health endpoint reports email backlog and failures (token-protected) | — |
| 5.5 | Deployment not reproducible | Medium | Dockerfile, docker-compose (with ClamAV), Render blueprint, DEPLOYMENT.md | fresh-clone install verified (TESTING.md) |

## Found by the 15 new Playwright tests (after the five audits), all fixed

| # | Finding | Sev. | Fix |
|---|---|---|---|
| E.1 | On a visitor's **first** visit the service worker took control and the app **reloaded the page**, wiping anything typed (e.g. a technician accepting an invitation) | **High** | Reload only when the user taps "Update"; e2e 3 asserts typed input survives the first install |
| E.2 | Values typed **before the page became interactive** were replaced by React 19 (reproduced with throttled scripts) | Medium | Form fields are read-only until hydration (usually < 1 s) |
| E.3 | A form submitted before scripts loaded fell back to **GET with fields (incl. passwords) in the URL** | **High** | Native POST target kept on every form; submit buttons disabled until ready; e2e 15 asserts `method="post"` |
| E.4 | After setting a new password, the page re-rendered as "link expired" instead of continuing | Medium | Freshly signed-in user is sent to the dashboard |
| E.5 | Success messages could appear twice (inline then after reload) | Low | Shown once, after the reload |

## Internal site model: review pass (2026-11-17)

After FixRelay was changed to an internal site maintenance system, the new screens were reviewed by screenshot (desktop and phone) and every browser journey was rewritten. Earlier findings that mention customers refer to the previous, contractor-facing version.

| # | Finding | Sev. | Fix | Evidence |
|---|---|---|---|---|
| I.1 | A manager holding a quote received by email could not record it without first sending link requests | Medium | "Capture a quote received by email" also available from "Assessed" (moves the job to "Getting quotes", no link sent) | `workflow.test.ts`, e2e feature 9 |
| I.2 | The contractor's page did not show the work they were asked to quote for (only the email did) | Medium | Scope stored on the link and shown at the top of the contractor page | e2e journey 2, `workflow.test.ts` |
| I.3 | After submitting a quote or completion the contractor stayed on a filled form (risk of duplicate submissions) | Medium | Page reloads to show the submitted quote / "completion received" | e2e journey 2 |
| I.4 | The QR sheet inserts generated SVG with `dangerouslySetInnerHTML` | Low (reviewed) | SVG comes only from the `qrcode` library and our own URL; documented in SECURITY.md | — |
| I.5 | Public QR reports could be abused for spam | Medium | Off by default; IP and per-site rate limits; manager screening queue; link rotation | e2e journey 3, `workflow.test.ts` |
| I.6 | Money wrapped in the quote comparison; bare "· 0" counts on location chips | Low | No-wrap amounts; "· N jobs" only when there are jobs | screenshots |
