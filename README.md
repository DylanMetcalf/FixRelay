# ManOp

**From reported to resolved.** Maintenance operations: requests, job cards and approvals in one place.

*ManOp was previously called Resultra and, before that, FixRelay; some technical names (database, Render service, session cookie) still use `fixrelay` for compatibility.*

**Live demo:** https://fixrelay-demo.onrender.com (free tier: the first load after idle takes about a minute).

ManOp is a multi-tenant SaaS **maintenance system for your own sites** (plants, warehouses, offices, schools, hospitality). It runs one workflow end to end:

> Someone on site reports a fault (app or QR code) → Assessment → **In-house** (assign a technician) **or contractor** (secure-link quotes → compare → approval by amount, PO) → Work with photo evidence → The reporter confirms it is fixed → Closed (and reopening)

It is deliberately *not* a CMMS, ERP or workflow builder. See [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) for what is intentionally out of scope.

## Features (implemented and tested)

**New in ManOp (2026-11-25)**
- **ManOp brand**: name (short for maintenance operations) and an M-with-check mark; colours unchanged.
- **Two ways a job runs**: managed (through maintenance management) or **one-person** ("I'll fix it myself": start to finish by one person, with evidence; manager sign-off optional per company). Dashboard tiles and filters for both.
- **Public sandbox** at `/demo`: anyone opens a private sample company with every role and job stage, no sign-up, gone after 24 hours.
- **Guided tour** across the real screens, and a public **How it works** page explaining both workflows.

**Added in the Resultra release**
- **Branded PDF job documents**: maintenance job card (with a handwriting area for printed cards), completed job report (before/after photos, verification, recorded signatures only), full job history, all A4, generated on the server from live data with access checks, a generation timestamp and a sign-in-required QR link. In-app viewer with Print and Download. See [PDF_DOCUMENTATION.md](PDF_DOCUMENTATION.md).
- **Departments and handovers**: departments with department managers; jobs belong to a department and are handed over with a reason; department queues on the dashboard; append-only handover record.
- **Employee self-registration**: site registration codes (expire, switch off, replace); employees ask for access with name, work email, department and optional job title, phone and photo; access only after email confirmation and administrator approval.
- **QR reporting improvements**: short random links per site, area and machine (`/r/{code}`, no database ids), name-only reporting with optional contact, double-submit protection, spam trap, emergency notice, printable **A4 QR signs** (PDF).
- **Duplicate and repeat handling**: likely duplicates flagged for a manager (link, kept on record, or dismiss); "the fault came back" links a new job to a closed one.
- **Dashboard**: unassigned, possible duplicates, reopened and completed tiles; department filter.
- **Platform admin** (`/platform`): create customer companies with first site, departments and an administrator invitation; onboarding progress, users, departments, subscriptions, email delivery and server errors. Account metadata only.
- **Demo environment**: departments and six sample people; "view as" any role (demo companies only); reset demo data; demo companies never send email.
- **Email links**: job emails link to the job; signed-out people sign in and return to it.

- **Accounts**: email confirmation, secure password reset, show/hide passwords, session hardening.
- **Company sign-up and onboarding**: trial subscription, a checklist computed from real records, branding (name, logo, colour), response times per priority, and an optional, clearly separated **demo workspace** with sample sites, contractors and jobs.
- **Team and roles**: Owner (site administrator), Maintenance manager, Approver (site/finance), Technician, Stores / procurement, and "Reports faults only" (free). Departments are separate from roles. Any member can be limited to certain sites. Invitations are single-use and expire.
- **Sites → Locations → Equipment**, with repair history and spend per machine.
- **Fault reporting**: from the app on a phone, or by scanning a **QR code** printed per site, location or machine (pre-fills where). Optional **reporting without an account** (name + phone), screened by a manager. Photos, priority (Critical / High / Medium / Low, chosen by the reporter on big cards, also on the QR form), emergency flag, due dates from priority rules.
- **Assessment**: findings, cause, work needed, materials, time, whether a contractor is needed, and **whether spares are needed** (in stock, or to be bought or quoted).
- **Spares and stores**: when spares are needed, stores and the maintenance manager are told at once. Stores see a queue (to issue / to order / ordered), issue from stock, record the supplier, order number and expected date, and mark them received; the technician and managers are told at each step. A technician can ask for more spares mid-job. "What happens next" shows Stores while a job waits for spares.
- **Jobs board**: **Open now** and **History** tabs, priority chips with live counts (All / Critical / High / Medium / Low), most urgent first, and each job card shows the first photo of the problem and opens the full job card.
- **In-house route**: assign a lead technician and helpers, planned dates, instructions; time and materials logged.
- **Contractor route**: contractor directory (VAT registered or not); **quote requests by secure link** (no contractor account) or capture a quote received by email; side-by-side comparison with the cheapest marked; revised quotes keep every version.
- **Spend approval**: limits per role (manager / approver / owner), "send for approval" to whoever can approve the amount, three-quote rule above a threshold (or a recorded reason), optional or required **PO numbers**.
- **Contractor appointment and completion**: appointment email with a completion link; the contractor submits what was done with photos; "not selected" emails to the others.
- **Confirmed fixed**: the person who reported it answers "Is it fixed?" (or signs on the technician's phone); "not fixed" sends it back, and contractors get a fresh link. Reopening needs a reason.
- **Digital maintenance work requisition**: every job is a numbered requisition (numbers can continue a paper book, e.g. 12600) laid out like the paper form, with automatic dates and times, a Projects box, root-cause boxes, the food-area "tools out = tools in, area clean" check, and drawn signatures on every line (submitted by, received by maintenance, quote sign-off, completed by, confirmed by originator, confirmed by manager). Signatures can be made compulsory. Print or save as PDF.
- **Simple QR reporting for anyone**: big text and buttons, one question per screen (tap the kind of problem, describe it, place already filled in from the code, optional photo, name and phone), a clear thank-you with the report number; the phone screen never zooms in on its own or slides sideways.
- **Guided forms**: reporting a fault and completing work go one section at a time, then show a review that reads like the requisition before signing.
- **Area reports**: per area of a site: faults, open jobs, time to fix, spend, root causes, equipment and the full requisition history; printable and CSV. Insights can be narrowed to one area; the most affected areas link straight through.
- **Audit trail**: append-only and enforced by a database trigger, shown on every job and in a printable **job report** (print → PDF).
- **Notifications**: in-app alerts plus an email outbox with deduplication, retries with backoff, failure tracking. A background worker sends emails and overdue alerts.
- **Dashboard and insights**: live counts per stage, "Needs your approval", public reports to screen; spend by site and equipment, in-house vs contractor, contractor performance (response time, win rate, time to fix, reopened), approval turnaround, all with written definitions; CSV export.
- **Subscriptions**: plans with entitlements stored in data (staff seats, sites, jobs), trial → grace → read-only. Data is never deleted.
- **Platform operator console**: no access to tenant data without a time-limited grant from the tenant; any access is audited and read-only.
- **Installable app (PWA)**: ManOp icon set, shortcuts, screenshots, an install button with iPhone instructions, an update prompt, and a branded offline page. It does **not** support offline data entry.
- **Landing page** for prospects, plus privacy and terms templates.
- **Upload safety**: ClamAV virus scanning, blocking of PDFs with scripts, and removal of photo location (EXIF/GPS) data.
- **Production plumbing**: SMTP or Resend email (branded HTML), Postgres or S3 file storage, a rate limiter shared across servers, retention clean-up, and data export.

## Quick start (local)

Requirements: Node 22+, PostgreSQL 14+ (tested on 16).

```bash
npm install
```

```bash
cp .env.example .env   # then edit DATABASE_URL if needed
```

```bash
createdb fixrelay_dev && createdb fixrelay_test   # or use psql
```

```bash
npx prisma migrate deploy
```

```bash
PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD='a long password' npm run db:seed
```

```bash
npm run dev       # http://localhost:3000, register a company at /register
```

```bash
npm run worker    # separate terminal: emails (printed to the console by default) and overdue alerts
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Background worker (email outbox, overdue scan, session cleanup) |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | Unit and integration tests (Vitest, against the real test database) |
| `npm run build && npm run test:e2e` | Browser end-to-end tests (35, Playwright, production build on port 3100) |
| `npm run db:migrate` | Apply migrations (production-safe) |
| `npm run db:migrate:dev` | Create a new migration in development |
| `npm run db:seed` | Plans and the platform operator account (idempotent) |

## Documentation

[EXISTING_SYSTEM_AUDIT](EXISTING_SYSTEM_AUDIT.md) · [TECHNICAL HANDOVER](MANOP_TECHNICAL_HANDOVER.md) · [PDF_DOCUMENTATION](PDF_DOCUMENTATION.md) · [BRAND](BRAND.md) · [AUDITS](AUDITS.md) · [POPIA](POPIA.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [WORKFLOWS](WORKFLOWS.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [PRODUCT_ROADMAP](PRODUCT_ROADMAP.md) · [BUILD_STATUS](BUILD_STATUS.md) · [AI_HANDOVER](AI_HANDOVER.md)

User guides (PDF, with screenshots of the running app): [docs/MANOP_USER_GUIDE.pdf](docs/MANOP_USER_GUIDE.pdf) · [docs/MANOP_SITE_ADMIN_GUIDE.pdf](docs/MANOP_SITE_ADMIN_GUIDE.pdf) · [docs/MANOP_PLATFORM_ADMIN_GUIDE.pdf](docs/MANOP_PLATFORM_ADMIN_GUIDE.pdf) · [docs/MANOP_PILOT_TESTING_GUIDE.pdf](docs/MANOP_PILOT_TESTING_GUIDE.pdf)

> Production use needs a separate security, operational and POPIA/compliance review first. See SECURITY.md and BUILD_STATUS.md.
