# Existing system audit (before the ManOp upgrade)

Date: 2026-11-21 · Audited commit: `f3da29a` (branch `claude/quirky-archimedes-x415o3`) · Checkpoint: commit `f3da29a` (local tag `pre-manop-checkpoint`; the commit is on the remote branch)

This records what FixRelay already did before it became **ManOp**, what needed improving, what was missing, and where the new requirements touch the existing design. Nothing was rebuilt; every change below is incremental.

## 1. Technology stack

| Layer | What is used |
|---|---|
| Web app | Next.js 15.5 (App Router, server components, server actions), React 19, TypeScript (strict) |
| Styling | Tailwind CSS 4 with a small design system in `src/app/globals.css` and `src/components/ui.tsx` |
| Data | PostgreSQL 16 through Prisma 6.19 (10 migrations, no drift). Every tenant table carries `orgId`; composite foreign keys stop cross-tenant links |
| Validation | zod 4 in the service layer |
| Files | `StoredFile` table (Postgres) or S3, chosen by `STORAGE_DRIVER`; uploads decoded and re-encoded with sharp, GPS removed, ClamAV scan when configured |
| Email | Outbox table + worker; transports `console`, `smtp`, `resend` (`src/server/email.ts`) |
| Background work | `src/worker.ts` (or in-process with `WORKER_IN_PROCESS=true`): email outbox, overdue alerts, retention |
| Tests | Vitest against a real Postgres test DB (76 tests), Playwright 1.63 on a production build (37 tests) with axe-core |
| Hosting | Render Blueprint (`render.yaml`, `render.demo.yaml`), Dockerfile, docker-compose; live demo at https://fixrelay-demo.onrender.com |

## 2. Database (summary)

Organisation (company, branding, approval rules, numbering, `publicReportingEnabled`, `requireSignatures`) → Membership (roles[], siteIds[], active) → User. Site (unique `publicToken`) → Location (food area flag) → Asset. **Job** is the single record that moves from report to closure (`JobStatus` NEW … CLOSED / CANCELLED, route in-house/contractor, priority, spares, owner, lead technician, dates). Children: Assessment, Quote (+ lines, versions), Decision (append-only), Completion (versions), WorkUpdate, Attachment, JobSignature (append-only), ActivityEvent (append-only, DB trigger), Notification, OutboxEmail, ContractorLink (hashed), SupportAccessGrant, Subscription/Plan, AuthToken, RateLimit.

Append-only tables (ActivityEvent, Decision, JobSignature) reject UPDATE/DELETE with triggers. That makes hard deletes of a company impossible by design, which matters for the demo reset (see §6).

## 3. Authentication and permissions

- Email + password (bcrypt), opaque server sessions (SHA-256 hashed token, `__Host-fr_session` cookie), membership re-checked on every request.
- Email confirmation, password reset, single-use expiring invitations (`/invite/[token]`).
- Roles: OWNER, MANAGER, APPROVER, TECHNICIAN, STORES, REQUESTER. A permission matrix is enforced in services (`src/server/permissions.ts`); `jobScope(ctx)` gives row-level visibility; site limits per member; out-of-scope IDs return 404.
- Platform operator (`User.isPlatformAdmin`) has a console at `/platform` with subscription controls and **read-only, time-limited, audited** support sessions that need a grant from the company owner.

## 4. Maintenance workflow (works today)

Report (app, QR, or public link without an account) → screen → assess (findings, cause, spares, quote needed?) → in-house (assign, start, log work) **or** contractor (quote requests by secure link, captured quotes, comparison, spend approval by limit, PO, appointment) → completion with evidence and root cause → reporter confirms fixed (or manager with a reason) → manager closes. Alternatives: on hold/resume, cancel with reason, not-fixed rework, reopen with reason, revised quotes, not approved. Spares: stores issue/order/receive. Priority set by the reporter. Jobs board with Open now / History and priority chips.

The job page (`/jobs/[id]`) is already the single source of truth: what, where, who reported, priority, responsible person, status, "What happens next", photos, assessments, quotes, approvals, work log, completion, signatures, full activity history.

## 5. Documents and printing (existing)

- `/jobs/[id]/report`: the digital **Maintenance Work Requisition** laid out like the paper form, printed through the browser (print CSS hides the app chrome). It fits one A4 page.
- `/quotes/[id]`: printable quote document.
- `/sites/[id]/qr`: A4 sheet of QR stickers (HTML print).
- **No server-generated PDFs exist.** There is no job card, no completion report and no history export as a file.

## 6. Branding, email and deployment

- Brand: "FixRelay" with an F-route mark (`public/brand/fixrelay-*.svg`, `src/components/logo.tsx`), colours Relay Navy `#0B1F3A`, Signal Amber `#F5A524`, Relay Blue `#1E5AA8`, Mist `#F3F5F8`. 51 customer-facing mentions in `src/` and `public/`.
- Emails: branded HTML; job notifications say "Open FixRelay to view the details" **without a link to the job**: a gap.
- After sign-in, `next=` is honoured by the login page, but pages that require a session redirect to `/login` **without** `next`, so a link from an email lands on the dashboard instead of the job: a gap.
- Demo: each user can create a separate `isDemo` company built by the real services; contractor emails use reserved domains. There are no demo personas, no role switching and no reset.
- Render: one web service with the worker in-process and files in Postgres (no reliance on the ephemeral disk). Health check `/api/health`.

## 7. Tests and documentation (existing)

76 Vitest tests (workflow, security/isolation, production plumbing, requisition, spares, audits) and 37 Playwright tests (4 journeys, 15 features, 16 requisition, 2 board/spares). Docs: README, ARCHITECTURE, WORKFLOWS, SECURITY, DATABASE, DEPLOYMENT, TESTING, BUILD_STATUS, AUDITS, AI_HANDOVER, POPIA, BRAND, PRODUCT_ROADMAP.

## 8. Requirement-by-requirement gap analysis

| Requirement | Today | Gap / plan |
|---|---|---|
| Rename to ManOp, new icon | FixRelay brand | Rename customer-facing text, metadata, manifest, emails, PDFs; new geometric mark in the same palette. Keep the cookie name, env vars, DB names and migrations unchanged for compatibility |
| Core workflow + alternatives | Complete, incl. hold, cancel, reopen, revised/rejected quotes | Add **repeat fault linked to an earlier job** |
| Job page shows everything | Yes | Add department, handovers, duplicate/repeat links, document buttons |
| QR reporting without login | `/r/{43-char token}`; areas and machines use `?l=<uuid>` / `?a=<uuid>` | Add **short, non-sequential codes** for sites, areas and machines (`/r/{code}`) so no database IDs appear; keep old links working. Make contact details optional (name required), add a double-submit guard, keep the safety warning (reworded) |
| Printable QR signage as PDF | HTML sticker sheet | Add a **server-generated A4 PDF sign** per site and area |
| Departments + handover | Missing | New `Department`, `DepartmentMember` (with department manager flag), `Job.departmentId`, `JobHandover` record; scope for department members; notifications |
| Employee self-registration with site code + approval | Only invitations | New `JoinCode` (expire / revoke / regenerate), pending memberships, approval screen, profile fields (job title, phone, photo) |
| Dashboards | Live counts per stage, overdue, to screen, spares | Add reopened, completed, unassigned, possible duplicates; department filter |
| Duplicate detection | Missing | Simple rule-based similarity (site, area, machine, category, recent, word overlap); flag for review; link / dismiss; never auto-merge |
| Reopen / repeat | Reopen with reason exists, closure kept | Add repeat-fault link |
| Branded job card / completion report / history PDFs | Missing (only HTML requisition print) | **Server-generated PDFs** with `@react-pdf/renderer` (pure JavaScript: works on Render without a browser), plus browser print views. Permission-checked, data from the live record, generation timestamp |
| Email notifications with secure links | Outbox and retries exist; no job links | Add the job link to every job email, `next=` return after sign-in, new events (handover, registration, approval) |
| Platform admin | Subscription + support sessions | Add create company + first site + main contact invitation, users and departments per company, onboarding progress, email delivery status, platform error log |
| Demo with personas, role switching, reset | Single-owner demo company | Add departments and persona users (reserved-domain emails), **"View as" only inside demo companies**, demo emails suppressed, reset (archive and rebuild, because audit tables are append-only) |
| 20+ Playwright scenarios + document tests | 37 tests, most scenarios covered | Add the missing scenarios (platform admin, company creation, registration/approval, departments, duplicates, email links, isolation) and PDF tests |
| Screenshot guides (4 PDFs) + technical handover | None | Generate from the running app with Playwright |
| Render / Resend | Working | Update for the new name, PDF fonts bundled in the repo, Resend domain steps |

## 9. Conflicts and risks identified

1. **Append-only audit tables vs demo reset**: deleting a demo company is blocked by triggers. Decision: the reset archives the old demo company (memberships deactivated) and builds a fresh one. Old demo rows stay; they are flagged `isDemo` and never visible to anyone.
2. **Platform owner seeing users and departments** vs the earlier rule that the console shows no company data. Decision: the console shows **account metadata only** (company, sites, contacts, users, roles, departments, onboarding, email delivery status), never jobs, quotes, photos or reports. Business data still needs a grant from the company.
3. **Role switching** must never work in production companies. Decision: only inside `isDemo` companies, only to persona users created by the demo builder, only by an owner of that demo company. Enforced in `loadSession`.
4. **QR links already printed** must keep working. Decision: old `publicToken` links still resolve; new codes are added alongside.
5. **Renaming** could break sessions or deployments. Decision: cookie name (`fr_session`), env vars, database and service names stay; only customer-facing text changes.
6. **PDF generation on Render**: Chromium-based PDF needs a browser that Render's Node runtime does not provide. `@react-pdf/renderer` avoids this; fonts are bundled in the repository so output is identical everywhere.
7. **Registration code is not authorisation**: a code only creates a *pending* request; access needs an administrator's approval.

## 10. Checkpoint

`git tag pre-manop-checkpoint` at commit `f3da29a` (recover with `git checkout pre-manop-checkpoint`). All schema changes in this upgrade are **additive** (new tables, new nullable or defaulted columns). Rollback: redeploy the tag; the extra columns and tables are ignored by the old code. No data is dropped.
