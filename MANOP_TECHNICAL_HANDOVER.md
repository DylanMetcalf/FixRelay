# ManOp – technical handover

*From reported to resolved.* Maintenance operations: requests, job cards and approvals in one place.

This document is for the next engineer. It explains how ManOp is built, where things live, how to run and test it, how to deploy it, and what is still open. Detailed references: ARCHITECTURE.md, DATABASE.md, WORKFLOWS.md, SECURITY.md, PDF_DOCUMENTATION.md, DEPLOYMENT.md, TESTING.md, BUILD_STATUS.md, EXISTING_SYSTEM_AUDIT.md.

## 1. What it is
A multi-company (multi-tenant) SaaS for internal site maintenance. Anyone on site reports a fault (signed in, or by scanning a QR code without an account); maintenance triages, assesses, fixes it in-house or through contractors (quotes, spend approval by amount), records the work with evidence, the reporter confirms, the manager closes. Every job is also a branded PDF job card. Departments, handovers, self-registration with approval, duplicate review, a platform admin and a demo environment were added in the ManOp upgrade.

## 2. Stack
| Layer | Choice |
|---|---|
| App | Next.js 15.5 App Router (server components + server actions), React 19, TypeScript strict |
| Styling | Tailwind CSS 4; design tokens in `src/app/globals.css`; UI kit in `src/components/ui.tsx` |
| Data | PostgreSQL 16, Prisma 6.19 (10 migrations, additive) |
| Validation | zod 4 in services |
| PDFs | `@react-pdf/renderer` 4.9 with bundled Inter fonts (`assets/fonts`) |
| Files | Postgres (`StoredFile`) or S3; sharp re-encodes images (strips GPS), ClamAV optional |
| Email | Outbox table + worker; `console`, `smtp` or `resend` transport |
| Tests | Vitest (real Postgres), Playwright 1.63 + axe-core, pdf.js for PDF assertions |
| Hosting | Render Blueprint (`render.yaml`, `render.demo.yaml`), Dockerfile |

## 3. Code map
```
src/
  app/
    (auth)/          login, register, join (employee self-registration), invite, verify-email, reset-password
    (app)/           signed-in app: dashboard, jobs (+[id], [id]/card, [id]/report), requests/new, sites, settings, …
    platform/        ManOp platform admin (/platform, /platform/[orgId])
    r/[token]/       public QR report page (/r/{code})
    c/[token]/       contractor secure links
    api/             jobs/[id]/documents/[kind] (PDFs), sites/[id]/signs (QR PDF), files, avatar, export, health, manifest
    actions/         server actions (auth, jobs, admin) – thin: parse FormData, call services
    _lib/            session (cookies, requireSession, loginUrl), action wrapper (errors → ErrorLog)
  server/
    services/        business logic; every function starts with requirePerm / jobScope
      jobs.ts            job lifecycle, duplicates, repeats, spares, public reports
      departments.ts     departments, members, handovers
      registration.ts    join codes, self-registration, approval, profile
      platform.ts        platform owner tools (account metadata only)
      demo.ts            demo company builder, personas, reset
      quotes.ts, approvals.ts, contractors.ts, sites.ts, orgs.ts, notifications.ts, attachments.ts, …
    pdf/             PDF documents (see PDF_DOCUMENTATION.md)
    permissions.ts   roles → permissions, jobScope (row-level visibility), canHandOver
    auth.ts          passwords, sessions, loadSession (incl. demo "view as"), setViewAs
    workflow.ts      status machine, labels, nextAction
    duplicates.ts    rule-based duplicate scoring (pure, unit-tested)
    errors.ts        logError → ErrorLog
    email.ts, storage.ts, scan.ts, qr.ts
  components/        Form (server-action forms), Stepper, QuickReport (QR form), DemoBar, Logo, …
  middleware.ts      passes the requested path so sign-in can return to it
prisma/schema.prisma, prisma/migrations/
tests/ (Vitest) · e2e/ (Playwright) · assets/fonts · public/brand (logo SVGs)
```

## 4. Data model (key parts)
- **Organisation** (company) → **Membership** (roles[], siteIds[], active, **status** ACTIVE/PENDING/REJECTED) → **User** (phone, jobTitle, photoKey, demoPersona).
- **Site** (publicToken + short **publicCode**) → **Location** (publicCode, foodArea) → **Asset** (publicCode).
- **Job**: one record from report to closure. New: `departmentId`, `duplicateStatus`, `possibleDuplicateIds`, `duplicateOfId`, `repeatOfId`, `submissionKey` (unique per company).
- **Department**, **DepartmentMember** (isManager), **JobHandover** (append-only), **JoinCode**, **ErrorLog**, `Session.actAsUserId` (demo only), `Organisation.archivedAt` (demo reset).
- Append-only by trigger: ActivityEvent, Decision, JobSignature, JobHandover.

## 5. Permissions
Roles: OWNER (site administrator), MANAGER (maintenance manager), APPROVER, TECHNICIAN, STORES, REQUESTER. Department membership is separate from roles. `jobScope(ctx)`: managers/approvers see all jobs at their sites; others see what they reported, lead/assist, own (handed to them), need spares (stores), or their department's work (department managers; technicians and stores in that department). Out-of-scope ids return 404. Handover: maintenance managers or the responsible department's manager. Platform owner: account metadata only; business data needs the company's time-limited, audited support grant. Full matrix: SECURITY.md.

## 6. Integrations
- **Email (Resend/SMTP):** `notify()` writes in-app notifications and outbox rows in the same transaction; the worker sends with retries; job emails link to `APP_URL/jobs/<id>`; signed-out people sign in and return there. Demo companies never queue email. Setup: DEPLOYMENT.md → Resend.
- **QR codes:** `qrcode` library; short codes resolved by `resolvePublicCode` (old `/r/<token>?l=&a=` links still work until the site link is replaced).
- **ClamAV:** `CLAMAV_HOST`; fail closed.
- **S3:** optional storage driver.

## 7. Running locally
```bash
npm ci
```

```bash
cp .env.example .env
```

Set `DATABASE_URL` (Postgres 16) in `.env`, then:

```bash
npm run db:migrate && npm run db:seed && npm run dev
```

Create a platform owner with `PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_PASSWORD=… npm run db:seed`. Register a company at `/register`, then "Explore a demo workspace" for sample data.

## 8. Testing
```bash
npm test
```

```bash
npm run build && npm run test:e2e
```

Vitest needs a Postgres test database (`TEST_DATABASE_URL`, default `postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test`); Playwright builds nothing itself (run `npm run build` first) and starts `next start` on port 3100. The ClamAV test runs when `CLAMAV_TEST_PORT` points at a clamd. Results and the scenario map: TESTING.md.

## 9. Deployment
Render Blueprint with Postgres; files in Postgres (no reliance on Render's temporary disk); migrations on start; health check `/api/health`; custom domain and HTTPS via Render; Resend for email. Step by step: DEPLOYMENT.md.

## 10. Brand assets
Edit `public/brand/manop-mark.svg` (512 grid) and regenerate PNG icons with sharp:
```bash
node -e "const s=require('sharp');[['manop-mark',32,'favicon-32.png'],['manop-square',180,'apple-touch-icon.png'],['manop-mark',192,'icon-192.png'],['manop-mark',512,'icon-512.png'],['manop-maskable',192,'icon-maskable-192.png'],['manop-maskable',512,'icon-maskable-512.png']].forEach(([f,n,o])=>s('public/brand/'+f+'.svg',{density:400}).resize(n,n).png().toFile('public/'+o))"
```
Keep `src/components/logo.tsx` and `src/server/pdf/brand.tsx` in step with the SVG paths.

## 11. Remaining tasks and known limits
See BUILD_STATUS.md for the PASS/PARTIAL table. Main items:
1. Move the demo from Render free (database expires 2026-12-17) to the paid Blueprint; buy and connect the ManOp domain; verify the Resend sending domain and run a live delivery check.
2. Docker image not built in the sandbox (no Docker there).
3. Real-user usability testing and an independent security review / penetration test before general release.
4. Content-Security-Policy still allows inline scripts (nonce-based CSP is a roadmap item).
5. Dev-only npm advisories (vitest mocker, s3rver/dicer) affect test tooling only; production dependencies report 0.
6. Push notifications, offline data entry and native apps are out of scope.
