# Database

PostgreSQL 16 via Prisma 6. Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`.

## Tenancy model

- `Organisation` = a **subscribing company that maintains its own sites** (the tenant).
- Every tenant-owned table has `orgId`. Child tables reference parents through **composite foreign keys `(orgId, parentId)`**, for example `Job(orgId, siteId) → Site(orgId, id)` and `Job(orgId, contractorId) → Contractor(orgId, id)`. So even raw SQL cannot attach company A's site or contractor to a job in company B (this is tested).
- `Membership(orgId, userId, roles[], siteIds[])` links a user to a tenant. An empty `siteIds` means all sites; otherwise lists, dashboards and approvals are limited to those sites (`siteFilter` / `jobScope`).
- Contractors are **not users**: they are directory records reached through `ContractorLink` tokens.

## Main entities

```
User ─< Membership >─ Organisation ─┬─ Subscription ─ Plan (maxUsers = staff seats, maxSites, maxJobsPerMonth)
                                     ├─ PriorityRule (per priority: response / completion hours)
                                     ├─ approval rules (manager / approver limits, PO required, quote threshold, min quotes)
                                     ├─ Invitation, SupportAccessGrant
                                     ├─ Contractor (name, trade, email, VAT registered)
                                     └─ Site (publicToken for QR codes) ─< Location
                                            └─< Asset (equipment)
Job (the fault report and the job are ONE record moving through JobStatus; route UNDECIDED | IN_HOUSE | CONTRACTOR;
     source APP | PUBLIC_LINK; reporter name/phone/email for public reports; contractorId, approvedCostCents, poNumber)
 ├─ JobTechnician (additional technicians)
 ├─ Assessment
 ├─ Quote (per contractor, versioned; viaLink; leadTimeDays) ─< QuoteLine
 │     └─ Decision (0..1: spend approval)
 ├─ ContractorLink (QUOTE | COMPLETION; hashed token, expiry, used/revoked; scope shown to the contractor)
 ├─ WorkUpdate (progress, notes, labour minutes, material cost)
 ├─ Completion (version 1..n; by a technician or a contractor) ─ Decision (0..1: fixed / not fixed)
 ├─ Attachment (kind: REQUEST/ASSESSMENT/PROGRESS/BEFORE/AFTER/TEST_DOCUMENT/QUOTE/SIGNATURE/LOGO)
 └─ ActivityEvent (append-only audit)
Notification (in-app), OutboxEmail (email queue), Session
AuthToken (password reset / email verification, hashed, single-use), RateLimit (shared limiter), StoredFile (file bytes for STORAGE_DRIVER=db)
```

Design choice: a "fault report" is the early stage of a job (statuses NEW, ASSESSING, ASSESSED). Keeping a single record avoids copying data and keeps one continuous history. "Reports" and "Jobs" in the UI are filtered views.

## Integrity constraints (`*_integrity_constraints` and `*_site_internal_model` migrations)

| Rule | Mechanism |
|---|---|
| Emails stored lower-case; at least one role | CHECK |
| Approval rules: limits ≥ 0, approver ≥ manager limit, min quotes 1–10 (`org_approval_rules`) | CHECK |
| A contractor is set only on contractor-route jobs (`job_contractor_route`) | CHECK |
| A job has a requester or a reporter name (`job_reporter`); approved cost ≥ 0 (`job_approved_cost`) | CHECK |
| Line quantity > 0, prices ≥ 0; quote total = subtotal + VAT; VAT 0–100%; lead time ≥ 0 | CHECK |
| Labour and material on work updates ≥ 0 | CHECK |
| At most one SUBMITTED completion per job | partial UNIQUE index |
| One decision per quote version and per completion | UNIQUE (`Decision.quoteId`, `Decision.completionId`) |
| Quote number+version unique per tenant; job reference unique per tenant; asset reference unique per tenant; site public token and link token hash globally unique | UNIQUE |
| `ActivityEvent` and `Decision` cannot be updated or deleted | trigger `fr_append_only` |
| Non-draft quotes: commercial fields (incl. contractor and lead time) frozen; cannot be deleted; their lines cannot change | triggers `fr_quote_frozen`, `fr_quoteline_frozen` |

## Money

- All amounts are **integer cents** (`Int`, max about R20 million per value). Quantities are `Decimal(12,3)`.
- Line total = round_half_up(quantity × unit price). VAT = round_half_up(taxable subtotal × rate), computed **once per quote**, not per line.
- Contractor quotes are one price excl. VAT; `Quote.vatRateBps` is 15% if the contractor is VAT registered when the quote is captured, otherwise 0. Later changes to the contractor never alter existing quotes.
- Spending limits are integer cents on `Organisation`; a null approver limit means unlimited.
- Currency is ZAR (`Organisation.currency` exists for the future; formatting is ZAR-only today).

## Concurrency strategy

- Every multi-step change runs in `prisma.$transaction`.
- Status changes use **guarded updates**: `UPDATE … WHERE id = ? AND status = <status read>` and require exactly 1 row (`jobs.ts → move()`). A concurrent change makes the second request fail with a friendly "changed by someone else" message.
- Reference numbers: `UPDATE Organisation SET jobSeq = jobSeq + 1 RETURNING` serialises per tenant, so references are unique and gap-free.
- Single-use tokens (contractor completion links, invitations) are claimed with guarded updates; approving one quote revokes the other contractors' links in the same transaction.
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

`purgeRetention()` (worker, every 6 hours): delivered/failed emails after 90 days, read notifications after 180 days and all after 365, used/expired auth tokens, expired sessions and rate-limit windows. Business records are kept.

Nothing else is hard-deleted by the application. Sites and contractors are archived / made inactive rather than deleted. See POPIA.md for the erasure process.

## Migration history note

`20261117154601_site_internal_model` converted the original contractor-facing model (customers, customer review links) to the internal site model: CLIENT roles became REQUESTER, `Client` and `ApprovalLink` were dropped, columns were renamed rather than dropped where data could be kept, and existing sites got a QR token. `20261117190000_contractor_link_scope` stores the quote-request scope on the link.
