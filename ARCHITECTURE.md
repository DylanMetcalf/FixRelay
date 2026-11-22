# Architecture

## Shape: a modular monolith

A single Next.js 15 (App Router) application, one PostgreSQL database, and one small background worker process. There are no microservices, queues-as-a-service or Kubernetes. Everything can run on one VM or one PaaS app plus a managed Postgres.

```
Browser (desktop / phone PWA)
   │  HTML + React Server Components, server actions (forms)
   ▼
Next.js app ── src/app/**            UI, routing, thin server actions (parse FormData → call service)
   │
   ▼
Service layer ── src/server/**       ALL business rules, permissions, tenant scoping, transactions
   │   permissions.ts  workflow.ts  auth.ts  storage.ts  services/*.ts
   ▼
Prisma ── PostgreSQL                 constraints, composite tenant FKs, triggers (append-only, frozen quotes)
   ▲
Worker ── src/worker.ts              email outbox (SKIP LOCKED), overdue alerts, expired-session cleanup
```

**Rule:** UI code never touches Prisma for business writes and never decides permissions. Every mutation goes through a service function that takes a `Ctx` (who is acting, in which tenant, with which roles) and checks permission first. This keeps the logic testable without a browser: the integration tests call services directly.

## Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | Safety for future maintainers and AI models |
| Web | Next.js 15.5 App Router, React 19 | Server rendering, server actions, one deployable |
| DB | PostgreSQL 16 + Prisma 6.19 | Relational integrity, migrations, typed client |
| Validation | Zod 4 | Every service input is parsed |
| PDFs | `@react-pdf/renderer` + bundled Inter fonts (`src/server/pdf`) | Server-generated A4 documents with no browser dependency, identical output on Render and locally |
| Styling | Tailwind CSS 4, small in-house component set (`src/components/ui.tsx`) | No heavy UI library. Components are simple and accessible (labels, focus rings, 44px targets) |
| Auth | Own email/password with bcrypt and opaque DB sessions (see SECURITY.md) | A small, fully understood surface. Sessions are revocable instantly. No third-party identity dependency. Can be swapped for Auth.js or a provider later |
| Files | `Storage` interface; Postgres, local-disk or S3 drivers | Chosen by `STORAGE_DRIVER` |
| Background jobs | DB-backed outbox + polling worker | Transactional: a notification exists only if its business change committed. No extra infrastructure |
| Money | Integer cents, BigInt arithmetic, half-up rounding | No floating-point error (`src/lib/money.ts`) |
| Tests | Vitest (real Postgres), Playwright (real browser, production build) | |

## Module boundaries (`src/server/services`)

| Module | Responsibility |
|---|---|
| `auth.ts` (in `src/server`) | Passwords, sessions, loading the acting context, switching workspace |
| `orgs.ts` | Tenant registration, settings, priority rules, team, invitations, support-access grants, platform tenant list |
| `sites.ts` | Sites (QR token, rotation), locations, equipment with spend, request-form options |
| `contractors.ts` | Contractor directory |
| `contractor-links.ts` | Secure contractor links (quote request, appointment/completion), their emails and revocation |
| `portal.ts` | What a contractor sees and submits through a link |
| `jobs.ts` | Fault reports (app and public QR), triage, assessment, in-house routing, assignment, execution, hold/resume, cancel, completion, confirm fixed, closure, reopen, lists and dashboard counts |
| `quotes.ts` | Request quotes, capture quotes, contractor quote versions, comparison, withdraw |
| `approvals.ts` | Spend approval by limit, send for approval, not approved, three-quote and PO rules, contractor appointment |
| `attachments.ts` | Upload validation (content sniffing), private reads, signatures, logo |
| `notifications.ts` | In-app notifications, email outbox, worker processing, overdue scan |
| `activity.ts` | Append-only audit events |
| `billing.ts` | Subscription state machine, entitlements, provider-neutral interface |
| `reports.ts` | Metric computation and definitions |
| `demo.ts` | Builds a demo workspace by driving the real services: departments, sample people (personas), jobs at every stage; reset; persona list for "view as" |
| `departments.ts` | Departments, department members and managers, job handovers |
| `registration.ts` | Site registration codes, self-registration (pending requests), approval/decline, own profile |
| `platform.ts` | Platform owner: create customer companies, overview (account metadata), customer detail, platform health |
| `src/server/pdf/*` | Job card, completion report, job history, QR signs (see PDF_DOCUMENTATION.md) |
| `src/server/duplicates.ts` | Rule-based duplicate scoring (pure functions) |
| `src/server/errors.ts` | `logError` → `ErrorLog` |

Shared foundations: `src/server/permissions.ts` (permission matrix and `jobScope`), `src/server/workflow.ts` (state machine, labels, next action), `src/lib/*` (db client, errors, money, tokens, rate limiting, colour).

## Request / data flow example: contractor quote → approval → appointment

1. The manager requests quotes (`quotes.requestQuotes`): in **one transaction** the job moves ASSESSED → QUOTING (route CONTRACTOR), one `ContractorLink` per contractor is created (256-bit token, only its SHA-256 stored, plus the scope), the RFQ emails are queued in the outbox and the audit events written.
2. Each contractor opens `/c/<token>` (public page rendered from `portal.getContractorLinkView`: only that job, its fault photos and the company branding) and submits a price (`submitQuoteViaLink` → `insertContractorQuote`: VAT if registered, earlier version superseded, quote frozen by trigger once submitted).
3. The manager compares (`compareQuotes`) and chooses one. `approvals.approveQuote` checks the caller's limit, validity, the three-quote rule and the PO rule; then records the Decision, rejects the other quotes and revokes their links, moves the job APPROVED → ASSIGNED with contractor, value and PO (guarded `move()`), issues the completion link and queues the appointment and "not selected" emails. Above the limit, `recommendQuote` sends it to the approvers who can approve that amount.
4. The contractor submits the completion with photos (`submitCompletionViaLink`, single use) → AWAITING_VERIFICATION → the reporter is asked "Is it fixed?".
5. The worker delivers queued emails, retrying with backoff.

## UI conventions

- Server components fetch through services. Forms use `<Form action={serverAction}>` (`src/components/form.tsx`).
- After a successful action the page **reloads** (or navigates to `redirectTo`) and shows a flash message. See the "Next.js caveat" in AI_HANDOVER.md for why this is used instead of `router.refresh()`.
- Desktop: a sidebar (Dashboard, Reports, Jobs, Quotes, Sites, Equipment, Contractors, Insights, Settings; technicians also get My jobs). Phone: a bottom bar (My jobs/Home, Report fault, Alerts, Profile).
- Public pages (`/r/<code>` fault report, `/c/<linkToken>` contractor portal) use `PublicShell` with the company's branding and no app navigation.
- Every job page shows **what happens next and who is responsible** (`nextAction()` in workflow.ts).

## Resultra additions (2026-11)

- **Sign-in return path:** `src/middleware.ts` adds the requested path as a request header; `requireSession` redirects signed-out people to `/login?next=<path>` (same-site paths only), so links in emails land on the job after sign-in. The login page skips its own "already signed in" redirect while re-rendering for the sign-in action, so the action's result decides where to go (dashboard, `/platform`, or the waiting-for-approval page).
- **Demo "view as":** `loadSession` builds the context from a sample person when the session carries `actAsUserId` and every safety condition holds (see SECURITY.md).
- **Documents:** `GET /api/jobs/:id/documents/:kind` and `GET /api/sites/:id/signs` stream PDFs; `/jobs/:id/card` is the in-app viewer.
- **Platform admin:** `/platform` and `/platform/[orgId]` are outside the tenant app layout and require `isPlatformAdmin`.
