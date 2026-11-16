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
| Validation | Zod 3 | Every service input is parsed |
| Styling | Tailwind CSS 4, small in-house component set (`src/components/ui.tsx`) | No heavy UI library. Components are simple and accessible (labels, focus rings, 44px targets) |
| Auth | Own email/password with bcrypt and opaque DB sessions (see SECURITY.md) | A small, fully understood surface. Sessions are revocable instantly. No third-party identity dependency. Can be swapped for Auth.js or a provider later |
| Files | `Storage` interface; local-disk driver (`STORAGE_DIR`) | Swap to S3-compatible storage by implementing 2 methods |
| Background jobs | DB-backed outbox + polling worker | Transactional: a notification exists only if its business change committed. No extra infrastructure |
| Money | Integer cents, BigInt arithmetic, half-up rounding | No floating-point error (`src/lib/money.ts`) |
| Tests | Vitest (real Postgres), Playwright (real browser, production build) | |

## Module boundaries (`src/server/services`)

| Module | Responsibility |
|---|---|
| `auth.ts` (in `src/server`) | Passwords, sessions, loading the acting context, switching workspace |
| `orgs.ts` | Tenant registration, settings, priority rules, team, invitations, support-access grants, platform tenant list |
| `clients.ts` | Customers, sites, locations, assets, request-form options |
| `jobs.ts` | Request logging, triage, assessment, direct authorisation, assignment, execution, hold/resume, cancel, completion, closure, reopen, lists and dashboard counts |
| `quotes.ts` | Quote create, save, submit, revise, view, list |
| `approvals.ts` | Review links, and customer decisions via link, portal, in person or internal recording |
| `attachments.ts` | Upload validation (content sniffing), private reads, signatures, logo |
| `notifications.ts` | In-app notifications, email outbox, worker processing, overdue scan |
| `activity.ts` | Append-only audit events |
| `billing.ts` | Subscription state machine, entitlements, provider-neutral interface |
| `reports.ts` | Metric computation and definitions |
| `demo.ts` | Builds a demo workspace by driving the real services |

Shared foundations: `src/server/permissions.ts` (permission matrix and `jobScope`), `src/server/workflow.ts` (state machine, labels, next action), `src/lib/*` (db client, errors, money, tokens, rate limiting, colour).

## Request / data flow example: customer approves a quote by link

1. A manager submits the quote (`quotes.submitQuote`): totals are recomputed on the server, the status becomes SUBMITTED (the DB trigger now freezes it), the job moves to AWAITING_APPROVAL, and an audit event and notifications are written in **one transaction**.
2. The manager creates a link (`approvals.createApprovalLink`): a 256-bit token is generated and only its SHA-256 is stored. An email is queued in the outbox, and the URL is shown once (copy / WhatsApp).
3. The customer opens `/q/<token>`, a public page rendered from `getLinkView`, which shows only that quote, its files and the tenant branding.
4. On submit (`decideViaLink`), one transaction claims the link (`usedAt`, guarded update), sets the quote to APPROVED (guarded), inserts the Decision (unique per quote), revokes sibling links, moves the job with a guarded `move()`, writes the audit event and notifies managers. Any concurrent second attempt fails cleanly.
5. The worker delivers queued emails, retrying with backoff.

## UI conventions

- Server components fetch through services. Forms use `<Form action={serverAction}>` (`src/components/form.tsx`).
- After a successful action the page **reloads** (or navigates to `redirectTo`) and shows a flash message. See the "Next.js caveat" in AI_HANDOVER.md for why this is used instead of `router.refresh()`.
- Desktop: a sidebar (Dashboard, Requests, Jobs, Quotes, Customers, Assets, Reports, Settings). Phone: a bottom bar (My jobs/Dashboard, New request, Alerts, Profile).
- Every job page shows **what happens next and who is responsible** (`nextAction()` in workflow.ts).
