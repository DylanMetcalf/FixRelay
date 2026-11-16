# Testing

## Strategy

| Layer | Tool | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Money parsing and rounding, VAT, the state machine, next-action, rate limiter | `tests/unit/` |
| Integration | Vitest + **real PostgreSQL** (`fixrelay_test`) | Services called directly: full workflow, alternatives, concurrency, security, notifications, subscriptions | `tests/integration/` |
| End-to-end | Playwright (Chromium) against a **production build** | The real UI in desktop and phone viewports, across several browser contexts (owner, technician, customer, rival company) | `e2e/` |

Integration tests do not mock the database. Each test creates its own tenant(s) with unique names, so tests are independent and the shared test DB also exercises isolation. `tests/global-setup.ts` runs `prisma migrate deploy` (non-destructive) and refuses any database whose name does not contain `test`.

## Commands

```bash
npm test                          # unit + integration (needs Postgres and TEST_DATABASE_URL, default fixrelay_test)
```

```bash
npm run build && npm run test:e2e # starts `next start -p 3100` against the test DB, runs Playwright
```

```bash
npm run typecheck
```

## Results (last run: 2026-11-16, Linux, Node 22, PostgreSQL 16.15, Chromium from Playwright 1.63)

- `npm run typecheck`: **pass** (0 errors)
- `npm test`: **46 / 46 passed**, 3 files (run twice back to back, both green)
- `npm run test:e2e`: **3 / 3 passed** (run twice, both green, about 13s)
- `npm run build`: **pass**

### What the suites cover

**Primary journey (integration and e2e)**: register a company → configure VAT/branding → invite and accept a technician → add a customer and site → log a request with a photo → send for assessment → technician assesses (phone viewport) → quote with labour and material lines, client-side totals matching server totals including 15% VAT (R 3 288.49) → secure link → customer approves without an account (the link cannot be reused) → assign → start → progress update → completion blocked without evidence → evidence → completion → manager cannot close → verification link → customer signs and approves → close → timeline contains all 10 key events → printable report → reports page counts it → reopen with a reason.

**Alternatives**: rejected quote (reason required) → revision v2, with both versions kept and v1 still REJECTED; revising a submitted quote supersedes it and kills its link; emergency authorisation without a quote (manager plus reason only); hold/resume; cancel (quotes withdrawn, links dead, terminal); variation quote blocks completion until decided; rejected completion → v2 signed in person → close → reopen; internal close only when sign-off is not required; sign-off cannot be waived after submission.

**Concurrency**: 6 simultaneous approvals on one link → exactly 1 decision; conflicting approve/reject/portal decisions → one wins and state is consistent; 12 parallel requests → unique gap-free references; triple start / completion / close → exactly one succeeds; concurrent invitation acceptance → one membership.

**Security**: everything listed at the end of SECURITY.md, plus e2e checks that a rival company gets 404 for a foreign job, its report and its file; that a technician gets the forbidden page for settings, quotes and reports and 404 (with no content leak) for a job they are not on; that anonymous users are redirected and files return 404; that an invalid link shows a safe page; and security headers.

**Notifications**: correct recipients, the actor excluded, deduplication, never across tenants, outbox retry with backoff → success → never re-sent, permanent FAILED after 5 attempts, overdue alert once.

**Subscriptions**: suspended tenant is read-only but every record stays readable; trial → grace → locked by dates; plan limits from the Plan row (portal users are not counted).

## Known gaps in testing (honest list)

- No load or performance tests. Reports aggregate in application code (capped at 5,000 rows per query).
- The email HTTP transport (`EMAIL_TRANSPORT=http`) has **never been run against a real provider**. Only the console transport and a fake transport in tests are verified.
- PWA installability was checked through the manifest and service-worker responses only, not by installing on a physical iOS/Android device. **Offline mode is not supported**: the service worker only shows an offline notice.
- Only Chromium was used for e2e (no Safari/WebKit or Firefox runs).
- No automated accessibility audit (axe) has been run. Basic practices were followed (labels, focus rings, contrast, 44px targets, skip link).
- The S3 storage driver does not exist yet, so it is untested.
- Not every page has an e2e test (asset pages, platform console UI, settings for priority rules and support grants are covered by service tests only).

## Failures found and fixed during development (for future reference)

1. **Prisma nested create with a composite FK** failed when copying quote lines on revision → changed to `createMany` (`quotes.ts`).
2. **Forms stuck on "Working…" / pages not updating in production builds** (Next 15.5.29): server-action responses that triggered `revalidatePath`/`redirect`, and later `router.refresh()` RSC fetches, were intermittently cancelled in the browser (`net::ERR_ABORTED`). Fixed by returning `redirectTo` and doing a full page navigation or reload after success, with a flash message (`src/components/form.tsx`). See AI_HANDOVER.md.
3. **React 19 cleared form fields after a failed action**, so users lost their input on validation errors → forms now submit through `startTransition` instead of the `action` prop.
4. **Denied job pages returned HTTP 200** (with not-found content) because a `loading.tsx` streaming boundary flushed headers first → boundary removed; denied pages now return 404.
5. Accepting an invitation unmounted its own form (the re-render showed "invalid") → the invite page now sends a signed-in visitor to the dashboard.
