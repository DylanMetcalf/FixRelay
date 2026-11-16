# Database

PostgreSQL 16 via Prisma 6. Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`.

## Tenancy model

- `Organisation` = a **subscribing maintenance company** (the tenant).
- `Client` = a **customer of that company** (a client organisation). It is not a tenant.
- Every tenant-owned table has `orgId`. Child tables reference parents through **composite foreign keys `(orgId, parentId)`**, for example `Job(orgId, siteId) → Site(orgId, id)`. So even raw SQL cannot attach company A's site to a job in company B (this is tested).
- `Membership(orgId, userId, roles[], clientId?)` links a user to a tenant. If `clientId` is set, the member is customer-side and hard-scoped to that client (a CHECK constraint enforces that the CLIENT role requires `clientId`).

## Main entities

```
User ─< Membership >─ Organisation ─┬─ Subscription ─ Plan
                                     ├─ PriorityRule (per priority: response / completion hours)
                                     ├─ Invitation, SupportAccessGrant
                                     └─ Client ─< Site ─< Location
                                                   └─< Asset
Job (request and job are ONE record moving through JobStatus)
 ├─ JobTechnician (additional technicians)
 ├─ Assessment
 ├─ Quote (number + version; ORIGINAL | VARIATION) ─< QuoteLine
 │     └─ Decision (0..1)   ApprovalLink (0..n)
 ├─ WorkUpdate (progress, notes, labour minutes, material cost)
 ├─ Completion (version 1..n) ─ Decision (0..1), ApprovalLink
 ├─ Attachment (kind: REQUEST/ASSESSMENT/PROGRESS/BEFORE/AFTER/TEST_DOCUMENT/QUOTE/SIGNATURE/LOGO)
 └─ ActivityEvent (append-only audit)
Notification (in-app), OutboxEmail (email queue), Session
```

Design choice: a "maintenance request" is the early stage of a job (statuses NEW, ASSESSING, ASSESSED). Keeping a single record avoids copying data and keeps one continuous history. "Requests" and "Jobs" in the UI are filtered views.

## Integrity constraints (`*_integrity_constraints/migration.sql`)

| Rule | Mechanism |
|---|---|
| Emails stored lower-case | CHECK |
| CLIENT role requires `clientId`; at least one role | CHECK |
| Line quantity > 0, prices ≥ 0; quote total = subtotal + VAT; VAT 0–100% | CHECK |
| Labour and material on work updates ≥ 0 | CHECK |
| A review link or decision points to exactly one subject | CHECK |
| At most one SUBMITTED and one APPROVED **original** quote per job | partial UNIQUE indexes |
| At most one SUBMITTED completion per job | partial UNIQUE index |
| One decision per quote version and per completion | UNIQUE (`Decision.quoteId`, `Decision.completionId`) |
| Quote number+version unique per tenant; job reference unique per tenant; asset reference unique per tenant | UNIQUE |
| `ActivityEvent` and `Decision` cannot be updated or deleted | trigger `fr_append_only` |
| Non-draft quotes: commercial fields frozen; cannot be deleted; their lines cannot change | triggers `fr_quote_frozen`, `fr_quoteline_frozen` |

## Money

- All amounts are **integer cents** (`Int`, max about R20 million per value). Quantities are `Decimal(12,3)`.
- Line total = round_half_up(quantity × unit price). VAT = round_half_up(taxable subtotal × rate), computed **once per quote**, not per line.
- `Quote.vatRateBps` snapshots the company's VAT rate when the quote is created (0 if not VAT registered). Later settings changes never alter existing quotes.
- Currency is ZAR (`Organisation.currency` exists for the future; formatting is ZAR-only today).

## Concurrency strategy

- Every multi-step change runs in `prisma.$transaction`.
- Status changes use **guarded updates**: `UPDATE … WHERE id = ? AND status = <status read>` and require exactly 1 row (`jobs.ts → move()`). A concurrent change makes the second request fail with a friendly "changed by someone else" message.
- Reference numbers: `UPDATE Organisation SET jobSeq = jobSeq + 1 RETURNING` serialises per tenant, so references are unique and gap-free.
- Single-use tokens (review links, invitations) are claimed with guarded updates.
- The email outbox is claimed with `FOR UPDATE SKIP LOCKED`, so several workers can run safely.

## Migration strategy

- **Development**: edit `schema.prisma`, then `npm run db:migrate:dev -- --name <change>`. For things Prisma cannot express (CHECKs, triggers, partial indexes), use `--create-only` and hand-edit the SQL, as in the integrity migration.
- **Production**: run only `npm run db:migrate` (`prisma migrate deploy`). It applies pending migrations and never resets.
- Never use `migrate reset` or `db push` against shared or production databases. Never edit an applied migration; add a new one.
- Destructive changes (dropping or renaming columns) are done in two releases: add the new column, backfill and switch code, then drop it later.
- Important: when adding a column to `Quote` that holds commercial content, also add it to the frozen-fields check in `fr_quote_frozen`.

## Seed data

`prisma/seed.ts` is idempotent: it creates default plans (trial, starter, professional) and, if the env vars are set, the platform operator. Sample business data is never seeded into real tenants. Demo data is created only on request, in a separate `isDemo` organisation (`services/demo.ts`).

## Retention

Nothing is hard-deleted by the application except draft quote lines (replaced on save) and expired sessions (worker). Customers are archived rather than deleted. A retention and erasure policy for POPIA still needs to be designed (see SECURITY.md).
