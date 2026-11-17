# FixRelay

**From fault reported to job completed. Every request, quote, approval and repair in one place.**

**Live demo:** https://fixrelay-demo.onrender.com (free tier: the first load after idle takes about a minute).

FixRelay is a multi-tenant SaaS for independent industrial and commercial maintenance contractors. It manages one workflow end to end:

> Fault reported → Assessment → Quotation → Customer approval → Assignment → Work in progress → Completion with evidence → Customer verification → Closure (and reopening)

It is deliberately *not* a CMMS, ERP or workflow builder. See [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) for what is intentionally out of scope.

## Features (implemented and tested)

- **Accounts**: email confirmation, secure password reset, show/hide passwords, and session hardening.
- **Company sign-up and onboarding**: trial subscription, a checklist computed from real records, branding (name, logo, colour), VAT settings, response times per priority, and an optional, clearly separated **demo workspace**.
- **Team and roles**: Owner, Manager/Dispatcher, Technician, Client representative, Requester. Invitations are single-use and expire. Removing access takes effect immediately.
- **Customers → Sites → Locations → Assets**, with a maintenance history per asset.
- **Maintenance requests**: reference numbers, priority, emergency flag, category, photos/PDFs, due dates from priority rules.
- **Assessment**: findings, cause, recommended work, materials, labour estimate, and whether a quote is needed.
- **Quotations**: labour, material and other lines; exact integer-cent maths; optional VAT; drafts; frozen once submitted; revisions keep every earlier version.
- **Customer decisions without an account**: secure, expiring, single-use review links for quotes and completed work, plus a customer portal, in-person signature capture, and staff-recorded decisions (clearly labelled).
- **Assignment**: lead technician, extra technicians, external contractor, planned dates, instructions.
- **Execution on mobile**: start, progress notes with labour and materials, photos, clarification and additional-work flags, hold/resume, variation quotes.
- **Completion and sign-off**: before/after photos and test documents are required as evidence; customer verification is required before closing (can be waived per job, with an audit entry); reopening needs a reason.
- **Audit trail**: append-only and enforced by a database trigger, shown on every job and in a printable **job report** (print → PDF).
- **Notifications**: in-app alerts plus an email outbox with deduplication, retries with backoff, and failure tracking. A background worker sends emails and overdue alerts.
- **Dashboard and reports**: live counts per stage, filters, and metrics with written definitions.
- **Subscriptions**: plans with entitlements stored in data, trial → grace → read-only. Data is never deleted.
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
| `npm run build && npm run test:e2e` | Browser end-to-end tests (18, Playwright, production build on port 3100) |
| `npm run db:migrate` | Apply migrations (production-safe) |
| `npm run db:migrate:dev` | Create a new migration in development |
| `npm run db:seed` | Plans and the platform operator account (idempotent) |

## Documentation

[BRAND](BRAND.md) · [AUDITS](AUDITS.md) · [POPIA](POPIA.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [WORKFLOWS](WORKFLOWS.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [PRODUCT_ROADMAP](PRODUCT_ROADMAP.md) · [BUILD_STATUS](BUILD_STATUS.md) · [AI_HANDOVER](AI_HANDOVER.md)

> Production use needs a separate security, operational and POPIA/compliance review first. See SECURITY.md and BUILD_STATUS.md.
