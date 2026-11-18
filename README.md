# FixRelay

**From fault reported to job completed. Every fault, quote, approval and repair across your sites in one place.**

**Live demo:** https://fixrelay-demo.onrender.com (free tier: the first load after idle takes about a minute).

FixRelay is a multi-tenant SaaS **maintenance system for your own sites** (plants, warehouses, offices, schools, hospitality). It runs one workflow end to end:

> Someone on site reports a fault (app or QR code) → Assessment → **In-house** (assign a technician) **or contractor** (secure-link quotes → compare → approval by amount, PO) → Work with photo evidence → The reporter confirms it is fixed → Closed (and reopening)

It is deliberately *not* a CMMS, ERP or workflow builder. See [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) for what is intentionally out of scope.

## Features (implemented and tested)

- **Accounts**: email confirmation, secure password reset, show/hide passwords, session hardening.
- **Company sign-up and onboarding**: trial subscription, a checklist computed from real records, branding (name, logo, colour), response times per priority, and an optional, clearly separated **demo workspace** with sample sites, contractors and jobs.
- **Team and roles**: Owner, Maintenance manager, Approver (site/finance), Technician, and "Reports faults only" (free). Any member can be limited to certain sites. Invitations are single-use and expire.
- **Sites → Locations → Equipment**, with repair history and spend per machine.
- **Fault reporting**: from the app on a phone, or by scanning a **QR code** printed per site, location or machine (pre-fills where). Optional **reporting without an account** (name + phone), screened by a manager. Photos, priority, emergency flag, due dates from priority rules.
- **Assessment**: findings, cause, work needed, materials, time, and whether a contractor is needed.
- **In-house route**: assign a lead technician and helpers, planned dates, instructions; time and materials logged.
- **Contractor route**: contractor directory (VAT registered or not); **quote requests by secure link** (no contractor account) or capture a quote received by email; side-by-side comparison with the cheapest marked; revised quotes keep every version.
- **Spend approval**: limits per role (manager / approver / owner), "send for approval" to whoever can approve the amount, three-quote rule above a threshold (or a recorded reason), optional or required **PO numbers**.
- **Contractor appointment and completion**: appointment email with a completion link; the contractor submits what was done with photos; "not selected" emails to the others.
- **Confirmed fixed**: the person who reported it answers "Is it fixed?" (or signs on the technician's phone); "not fixed" sends it back, and contractors get a fresh link. Reopening needs a reason.
- **Digital maintenance work requisition**: every job is a numbered requisition (numbers can continue a paper book, e.g. 12600) laid out like the paper form, with automatic dates and times, a Projects box, root-cause boxes, the food-area "tools out = tools in, area clean" check, and drawn signatures on every line (submitted by, received by maintenance, quote sign-off, completed by, confirmed by originator, confirmed by manager). Signatures can be made compulsory. Print or save as PDF.
- **Audit trail**: append-only and enforced by a database trigger, shown on every job and in a printable **job report** (print → PDF).
- **Notifications**: in-app alerts plus an email outbox with deduplication, retries with backoff, failure tracking. A background worker sends emails and overdue alerts.
- **Dashboard and insights**: live counts per stage, "Needs your approval", public reports to screen; spend by site and equipment, in-house vs contractor, contractor performance (response time, win rate, time to fix, reopened), approval turnaround, all with written definitions; CSV export.
- **Subscriptions**: plans with entitlements stored in data (staff seats, sites, jobs), trial → grace → read-only. Data is never deleted.
- **Platform operator console**: no access to tenant data without a time-limited grant from the tenant; any access is audited and read-only.
- **Installable app (PWA)**: FixRelay icon set, shortcuts, screenshots, an install button with iPhone instructions, an update prompt, and a branded offline page. It does **not** support offline data entry.
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
| `npm run build && npm run test:e2e` | Browser end-to-end tests (19, Playwright, production build on port 3100) |
| `npm run db:migrate` | Apply migrations (production-safe) |
| `npm run db:migrate:dev` | Create a new migration in development |
| `npm run db:seed` | Plans and the platform operator account (idempotent) |

## Documentation

[BRAND](BRAND.md) · [AUDITS](AUDITS.md) · [POPIA](POPIA.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [WORKFLOWS](WORKFLOWS.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [PRODUCT_ROADMAP](PRODUCT_ROADMAP.md) · [BUILD_STATUS](BUILD_STATUS.md) · [AI_HANDOVER](AI_HANDOVER.md)

> Production use needs a separate security, operational and POPIA/compliance review first. See SECURITY.md and BUILD_STATUS.md.
