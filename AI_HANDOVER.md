# AI handover guide

For future AI coding assistants (and humans). Read this first, then BUILD_STATUS.md, WORKFLOWS.md and SECURITY.md. The repository is self-contained: you do not need the original conversation.

## What this is

FixRelay is a multi-tenant maintenance job management SaaS (Next.js 15 + PostgreSQL + Prisma). Its one workflow is request → assessment → quote → customer approval → assignment → work → completion evidence → customer verification → closure. Commercial niche: South African industrial and commercial maintenance contractors serving multiple client sites. Currency ZAR; VAT is optional per company.

## Project map

```
prisma/schema.prisma            data model (read DATABASE.md)
prisma/migrations/              init + hand-written integrity_constraints (CHECKs, partial uniques, triggers)
prisma/seed.ts                  plans + platform operator (idempotent)
src/lib/                        db client, AppError, money (integer cents), tokens, rate limit, colour
src/server/permissions.ts       Ctx type, PERMISSIONS matrix, can/requirePerm, jobScope()  ← security core
src/server/workflow.ts          TRANSITIONS, STATUS_LABEL, nextAction()                    ← lifecycle core
src/server/auth.ts              passwords, sessions, loadSession() builds Ctx
src/server/storage.ts           Storage interface + local driver
src/server/services/*.ts        ALL business logic (see ARCHITECTURE.md table)
src/worker.ts                   email outbox + overdue scan loop
src/app/_lib/session.ts         cookie handling, requireSession/requirePage
src/app/_lib/action.ts          run() wrapper for server actions → ActionState
src/app/actions/*.ts            server actions: parse FormData → call ONE service → return
src/app/(app)/**                signed-in pages (layout = shell + nav + banners)
src/app/(auth)/**               login, register, invite
src/app/q|v/[token]             public customer review pages (quote / completion)
src/app/api/**                  files (private), public link files, manifest, health, logout
src/components/                 ui.tsx (server-safe primitives), form.tsx (Form/Submit/Flash), client*.tsx
tests/unit, tests/integration   Vitest; integration uses the real fixrelay_test DB
e2e/                            Playwright journey tests (production build, port 3100)
```

## Conventions (follow them)

1. **Every business operation is a service function `fn(ctx: Ctx, ...)`.** First line: `requirePerm(ctx, "...")`. Validate input with Zod. Write inside `prisma.$transaction`. Log an audit event with `logEvent(tx, actorOf(ctx), jobId, "type", "Human summary")` in the same transaction. Notify with `notify(tx, {..., eventKey})` using a stable `eventKey`.
2. **Job reads always spread `jobScope(ctx)`** into the `where`, or go through `loadJob(tx, ctx, id)`. Never query jobs by id alone.
3. **Status changes only via `move(tx, orgId, job, to, data)`**, which checks `TRANSITIONS` and does a guarded update. To add a transition, edit `TRANSITIONS` in workflow.ts, then add the service, a test and a WORKFLOWS.md row.
4. **Throw `AppError`** (`forbidden`, `notFound`, `conflict`, `invalid`) for anything a user should see. Other errors become a generic message. Return `notFound` (not forbidden) for objects outside the caller's scope.
5. **Money**: integer cents only; use `src/lib/money.ts`. Never use floats for amounts. Never trust totals from the client: the server recomputes.
6. **Server actions** (`src/app/actions`) stay thin: `return run(async () => { await service(...); return { ok: "Message" } | { redirect: "/path" } })`. Do not call `redirect()` or `revalidatePath()` inside actions (see the caveat below).
7. **Pages** are server components that call services and handle `AppError` with `notFound()`. Guard pages with `requirePage("permission")`.
8. **Links**: import `Link` from `@/components/link` (prefetch disabled), not `next/link`.
9. **Schema changes**: add a migration (never edit applied ones). If you add a commercial field to `Quote`, extend the `fr_quote_frozen` trigger. Tenant-owned tables need `orgId` plus composite FKs `(orgId, parentId)`.
10. **Tests**: add an integration test for every new rule and every permission edge. Create a fresh tenant per test with `tenant()` from `tests/helpers.ts`. Run `npm test`. For UI flows, extend `e2e/journey.spec.ts`.
11. Keep the product narrow. Read the "out of scope" section in PRODUCT_ROADMAP.md before adding features.

## ⚠️ Next.js caveat (important, cost real debugging time)

With **Next 15.5.29** production builds, server actions whose responses included a server-side re-render (from `revalidatePath`, `redirect()`, or cookies being set) and later `router.refresh()`/`router.push()` RSC fetches were **intermittently cancelled in the browser** (`net::ERR_ABORTED`). The result was forms stuck on "Working…" or pages not showing new data. It did **not** reproduce in `next dev`. Workaround (in `src/components/form.tsx`):
- actions return `{ ok, redirectTo? }` and never redirect or revalidate on the server;
- on success the form does `window.location.assign(redirectTo)` or `window.location.reload()`, and the message is carried by `sessionStorage` (`<Flash/>`);
- forms submit through `startTransition(() => formAction(fd))` from `onSubmit` instead of `<form action>`, because React 19 **resets all fields after a form action even when it fails** (users lost their input).
If you upgrade Next.js, you can try returning to `router.refresh()`, but **verify with `npm run build && npm run test:e2e`** (production mode), not in dev.
Also: do not add `loading.tsx` to the `(app)` group. Streaming flushes a 200 status before `notFound()`, so denied pages would stop returning 404 (an e2e test checks this).

## Business rules quick reference

See WORKFLOWS.md for the full list. The ones most easily broken:
- A job requiring customer sign-off can close only from VERIFIED, with a **non-INTERNAL** approval of the **latest** completion.
- Completion needs an AFTER photo or TEST_DOCUMENT, and no open variation quote.
- Approved quotes are immutable (also enforced by the DB). Revisions are new rows (same number, version + 1).
- Direct authorisation without a quote: manager plus reason; from NEW only if emergency.
- Customer-side users (`ctx.clientId`) are hard-scoped to one client and never get staff roles. `getJob` strips internal data for them.
- The platform operator sees tenant data only with a live `SupportAccessGrant`, read-only, and audited.
- Subscription lock = read-only, never data loss.

## Local environment

```bash
npm install && cp .env.example .env && npx prisma migrate deploy
```

```bash
npm run dev
```

Test DB: `fixrelay_test` (see `vitest.config.ts`, `playwright.config.ts`). In the original build environment Postgres was started with `service postgresql start`, with a role `fixrelay`/`fixrelay` owning `fixrelay_dev` and `fixrelay_test`.
Prisma refuses `migrate reset` when driven by an AI agent without explicit user consent. That is intentional: tests use `migrate deploy` and unique data instead of resets.

## Completed work

All of Priority 1–4 in the original brief: architecture, data model with integrity constraints, every core module, a responsive and mobile UI, a branded PWA (no offline data entry), onboarding with a demo workspace, dashboards, reports, subscriptions foundation, support access, 46 integration/unit tests and 3 e2e tests (all passing). Details: BUILD_STATUS.md.

## Recommended next steps (in order)

1. Password reset plus email verification (new `PasswordReset` table with hashed single-use token, 1h expiry; reuse `queueEmail`).
2. Wire and test a real email provider (`EMAIL_TRANSPORT=http` in `src/worker.ts`). Add branded HTML templates.
3. S3-compatible `Storage` driver; a Postgres-backed rate limiter.
4. Billing adapter (Paystack/PayFast) implementing `BillingProvider` and calling `setSubscription`.
5. POPIA tooling: per-customer data export, retention jobs, EXIF stripping in `attachments.ts`.
6. Error tracking (Sentry) and an axe accessibility pass. Add WebKit to the Playwright projects.
7. Product: quote reminders, response-time SLA tracking, technician day view, customer "awaiting approval" home.

## Known issues

Listed in BUILD_STATUS.md under "Known issues / limitations". None are known to break the main workflow.
