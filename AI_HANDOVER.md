# AI handover guide

For future AI coding assistants (and humans). Read this first, then BUILD_STATUS.md, WORKFLOWS.md and SECURITY.md. The repository is self-contained: you do not need the original conversation.

## What this is

Resultra is a multi-tenant **internal site maintenance** SaaS (Next.js 15 + PostgreSQL + Prisma). Its one workflow is: someone on site reports a fault (app or QR code) → assessment → **in-house** (technician) **or contractor** (secure-link quotes → compare → approval by amount, PO) → work with evidence → the reporter confirms it is fixed → closed. Until 2026-11-17 it was a tool for contractors serving customers; that model (Client, ApprovalLink, /q and /v pages, customer portal) was removed. See WORKFLOWS.md.

## Project map

```
prisma/schema.prisma            data model (read DATABASE.md)
prisma/migrations/              init + hand-written integrity_constraints (CHECKs, partial uniques, triggers)
prisma/seed.ts                  plans + platform operator (idempotent)
src/lib/                        db client, AppError, money (integer cents), tokens, rate limit, colour
src/server/permissions.ts       Ctx type, PERMISSIONS matrix, can/requirePerm, jobScope()  ← security core
src/server/workflow.ts          TRANSITIONS, STATUS_LABEL, nextAction()                    ← lifecycle core
src/server/auth.ts              passwords, sessions, loadSession() builds Ctx
src/server/storage.ts           Storage drivers: db (default) | s3 | local
src/server/scan.ts              upload safety: ClamAV, PDF active content, image re-encode (EXIF strip)
src/server/email.ts             email transports (console | smtp | resend) + branded HTML template
src/server/jobs-runner.ts       background loop (outbox, overdue, retention) for worker or WORKER_IN_PROCESS
src/server/services/account.ts  password reset, email verification, requireVerifiedEmail
src/server/services/export.ts   company data export (POPIA)
src/server/services/*.ts        ALL business logic (see ARCHITECTURE.md table)
src/worker.ts                   standalone worker (uses jobs-runner)
src/instrumentation.ts          starts the loop in-process when WORKER_IN_PROCESS=true
src/components/logo.tsx         Resultra mark + wordmark (see BRAND.md)
src/app/_lib/session.ts         cookie handling, requireSession/requirePage
src/app/_lib/action.ts          run() wrapper for server actions → ActionState
src/app/actions/*.ts            server actions: parse FormData → call ONE service → return
src/app/(app)/**                signed-in pages (layout = shell + nav + banners)
src/app/(auth)/**               login, register, invite
src/app/c/[token]               contractor portal (quote / completion by secure link)
src/app/r/[token]               site fault-report page behind QR codes (public reporting when enabled)
src/app/api/**                  files (private), public link files, manifest, health, logout
src/components/                 ui.tsx (server-safe primitives), form.tsx (Form/Submit/Flash), client*.tsx
tests/unit, tests/integration   Vitest; integration uses the real fixrelay_test DB
e2e/                            Playwright: journey.spec (3) + features.spec (15); helpers read emailed links from the outbox
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
Also: do not add `loading.tsx` to the `(app)` group.

**More browser caveats (each caused a real bug; keep the fixes):**
- The service worker must **not** reload the page on `controllerchange` unless the user tapped "Update". The first install also fires it, and a reload wipes a first-time visitor's typing.
- `<Form>` keeps `action={formAction} method="post"` **and** `onSubmit`. Without the native POST target, a submit before scripts load becomes a GET with the password in the URL.
- `<Form>` wraps fields in `<fieldset disabled={!hydrated}>` and `<Submit>` is disabled until hydrated, because React 19 replaces values typed before hydration.
- Pages that a successful action "consumes" (invite, reset password) must redirect a now-signed-in visitor, because the action response re-renders the same page.
- In tests, wait for `networkidle` (helpers `gotoReady`) before typing, and pick visible elements (`filter({ visible: true })`): job lists render a phone and a desktop layout. Streaming flushes a 200 status before `notFound()`, so denied pages would stop returning 404 (an e2e test checks this).

## Business rules quick reference

See WORKFLOWS.md for the full list. The ones most easily broken:
- With `reporterConfirmation` on, a job closes only from VERIFIED; a manager may confirm instead of the reporter only with a reason (INTERNAL decision) or the reporter's signature (IN_PERSON).
- In-house completion needs an AFTER photo or TEST_DOCUMENT; contractor completion via link needs at least one photo and is single use.
- Submitted quotes are immutable (DB trigger, incl. contractor and lead time). A contractor's new quote is a new version; the previous SUBMITTED one becomes SUPERSEDED.
- Approving a quote: caller's `approvalLimit`, validity, the multi-quote rule (or exception reason) and the PO rule are checked in `approvals.approveQuote`; everything else (reject others, revoke links, appoint, emails) happens in the same transaction.
- In-house routing (`routeInHouse`): manager; from NEW only if emergency; withdraws open quotes and tells the contractors.
- `ctx.siteIds` (empty = all) limits members to sites via `jobScope`/`siteFilter`. Requesters see only their own reports; `getJob` strips assessments, quotes, prices, work notes and internal photos for non-staff. Contractors are never users: they only reach `/c/<token>`.
- The platform operator sees tenant data only with a live `SupportAccessGrant`, read-only, and audited.
- Subscription lock = read-only, never data loss.

## Local environment

```bash
npm install && cp .env.example .env && npx prisma migrate deploy
```

```bash
npm run dev
```

Test DB: `fixrelay_test` (see `vitest.config.mts`, `playwright.config.ts`). In the original build environment Postgres was started with `service postgresql start`, with a role `fixrelay`/`fixrelay` owning `fixrelay_dev` and `fixrelay_test`.
Prisma refuses `migrate reset` when driven by an AI agent without explicit user consent. That is intentional: tests use `migrate deploy` and unique data instead of resets.

## Completed work

All of Priority 1–4 in the original brief: architecture, data model with integrity constraints, every core module, a responsive and mobile UI, a branded PWA (no offline data entry), onboarding with a demo workspace, dashboards, reports, subscriptions foundation, support access, 46 integration/unit tests and 3 e2e tests (all passing). Details: BUILD_STATUS.md.

## Second round (2026-11-17)
Closed the production gaps (reset/verification, email transports, shared storage and rate limit, antivirus, EXIF strip, retention, export), added the brand/landing/PWA, ran five self-audits (AUDITS.md) and added 15 Playwright tests. Each piece is documented in BUILD_STATUS.md.

## Recommended next steps (in order)

1. Deploy (Render blueprint or Docker Compose) and send real email through your provider; check `/api/health?token=`.
2. Independent penetration test and legal review of `/privacy`, `/terms`, POPIA.md; MFA for owners and the operator.
3. Nonce-based CSP; automated "anonymise person" tool; post-cancellation deletion schedule.
4. Billing adapter (Paystack/PayFast) implementing `BillingProvider` and calling `setSubscription`.
5. Error tracking (Sentry); add WebKit (Safari) to the Playwright projects; test installs on real iPhone/Android.
7. Product: quote-deadline reminders to contractors, contractor ratings, planned/preventive maintenance schedules, technician day view, PO document generation.

## Known issues

Listed in BUILD_STATUS.md under "Known issues / limitations". None are known to break the main workflow.

## Resultra release (2026-11-22) – read this first

- The product is now **Resultra** ("From reported to resolved."). Start with RESULTRA_TECHNICAL_HANDOVER.md, then EXISTING_SYSTEM_AUDIT.md (what existed and why choices were made) and BUILD_STATUS.md (acceptance matrix).
- Technical names intentionally still say `fixrelay` (cookie `fr_session`, DB names, Render services, export format id). Do not rename them without a migration plan.
- New services: `departments.ts`, `registration.ts`, `platform.ts`; PDFs in `src/server/pdf/`; duplicate scoring in `src/server/duplicates.ts`; `logError` in `src/server/errors.ts`.
- **react-pdf gotcha:** never put `lineHeight` on the `<Page>` style: it stops fixed footers from rendering. Put it on text styles.
- **Sign-in gotcha:** the login page must not redirect while re-rendering for the sign-in server action (`next-action` header); the action's result navigates (full page load in `Form`).
- **Demo view-as** is enforced in `loadSession`/`setViewAs` only; keep both checks if you touch sessions.
- E2E tests share one browser and do not close pages, so failure screenshots can show other tests' pages. Re-run a single failing test with `-g` for a clean picture (but `journey.spec.ts` is serial: run the whole file).
- Guides: `node scripts/guides/capture.cjs` (needs a running server and DB) then `node scripts/guides/build.cjs`.
