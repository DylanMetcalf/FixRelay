# Security

> Not security-certified and **not** certified POPIA compliant. An independent security review and a POPIA assessment are required before production use with real customer data.

## Authentication (`src/server/auth.ts`)

- Email + password. Passwords are 10–72 characters (the bcrypt limit) and hashed with **bcrypt cost 12** (`BCRYPT_COST`, lowered only in tests).
- Unknown-email logins run a dummy bcrypt comparison, so response time does not reveal which emails exist.
- Sessions are opaque random 256-bit tokens in an **httpOnly, SameSite=Lax, Secure (production)** cookie. Only the **SHA-256** of the token is stored. They last 30 days and are revocable server-side.
- Every request reloads the session **and the membership**. Deactivating a member or revoking support access takes effect on the next request.
- Changing a password revokes all other sessions. Logout deletes the session row (POST `/api/logout`).
- Rate limits: login (20 per 10 min per IP, 8 per 10 min per email), registration (10 per hour per IP), invitation acceptance and review-link decisions (per IP). **The limiter is in memory** (`src/lib/rate-limit.ts`): it is per-instance and resets on restart, so replace it with Redis/Postgres before running more than one instance.
- **Not implemented yet:** password reset by email, email verification at sign-up, MFA. See BUILD_STATUS.md.

## Authorisation (`src/server/permissions.ts`)

All checks are server-side in the service layer. The UI only hides controls.

| Permission | Owner | Manager | Technician | Client rep | Requester | Platform support* |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| org.manage (settings, branding, support grants) | ✓ | | | | | |
| team.manage (invite staff, roles, deactivate) | ✓ | | | | | |
| team.view | ✓ | ✓ | | | | ✓ |
| clients.manage (customers, sites, assets, invite customer users) | ✓ | ✓ | | | | |
| clients.view | ✓ | ✓ | ✓ | | | ✓ |
| job.create | ✓ | ✓ | ✓ | ✓ | ✓ | |
| job.viewAll | ✓ | ✓ | | | | ✓ |
| job.manage (triage, authorise, assign, cancel, close, reopen, priority) | ✓ | ✓ | | | | |
| job.assess / job.work | ✓ | ✓ | ✓ (assigned jobs only) | | | |
| quote.manage | ✓ | ✓ | | | | |
| quote.view (non-draft only for clients) | ✓ | ✓ | | ✓ | | ✓ |
| customer.decide (portal approvals and sign-off) | | | | ✓ | | |
| signoff.capture (customer signs on staff device) | ✓ | ✓ | ✓ (assigned) | | | |
| reports.view | ✓ | ✓ | | | | ✓ |

\*Platform support is read-only and needs a grant from the tenant (see below).

**Row-level job visibility (`jobScope`)**, which every job query uses:
- Owner/Manager: all jobs in the tenant. Technician: jobs they lead, are added to, or reported. Client rep: jobs of their own client only. Requester: jobs they reported.
- A member with `clientId` can **never** see another client's jobs, whatever roles they hold. Customer users cannot be given staff roles (enforced when inviting and updating).
- Customer-side views remove internal data **in the service** (`getJob`): assessments, work log, instructions, internal attachments (progress/assessment photos), draft and withdrawn quotes, and internal audit events. Technicians never receive pricing.
- Cross-tenant IDs return **404 Not Found** (never 403), so they don't reveal that records exist.

**Subscription lock**: write permissions are refused when a subscription is suspended or expired past grace. Reading and printing stay available.

## Tenant isolation layers

1. Every service query filters on `ctx.orgId`. `ctx` comes only from the server-side session.
2. Composite foreign keys `(orgId, id)` stop cross-tenant references even if a query bug slipped through.
3. A session can only be switched to an organisation the user actively belongs to. A forced `activeOrgId` with no membership falls back to the user's own company (tested).
4. Automated tests try reads, writes, references, forged decisions, links and files across tenants (see TESTING.md).

## Platform operator vs tenant administrator

- `User.isPlatformAdmin` (the SaaS operator) is **not** a tenant role. The platform console (`/platform`) shows only account and subscription metadata.
- To view a tenant, the tenant's **Owner must grant support access** (with a reason; 4h, 24h or 72h maximum; revocable). The operator then enters a **read-only** session, and the entry is written to the tenant's audit trail. Expired or revoked grants end access immediately.

## Customer review links

- 256-bit tokens. Only the SHA-256 is stored. A link is scoped to one quote or one completion, expires (14 days, capped at the quote's validity), is single-use, and is revoked when the quote is revised, the job is cancelled, or any decision is recorded.
- Link pages show only that subject's data and files bound to it. File access via a link is checked against the link's quote or completion.
- `Referrer-Policy: no-referrer` site-wide so tokens do not leak to other sites. Email bodies containing links are cleared from the outbox once sent.
- The decision records the typed name, the recipient email the link was sent to, a timestamp, and the IP. **Possession of the link is the credential.** Anyone the customer forwards it to can decide. This is stated on the page. For higher assurance, use the portal (signed-in) channel.

## Signatures

Drawn signatures (PNG) are stored as evidence of acknowledgement, with name, time and decision. They are **not** advanced electronic signatures under the ECT Act, and the product makes no legal-equivalence claim (stated in job reports).

## Uploads (`services/attachments.ts`, `app/api/files`)

- Type is decided by **magic bytes**: JPEG, PNG, WebP, PDF only. Client filename and MIME type are ignored. SVG, HTML and executables are rejected.
- 10 MB per file (logo 1 MB, signature 300 KB), 100 files per job. Filenames are sanitised. Storage keys are random UUIDs.
- Files are never public. They are served only by `/api/files/:id` after tenant, job-scope and kind checks, with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Cache-Control: private, no-store`.
- **Not implemented:** antivirus scanning, image re-encoding (EXIF/GPS metadata in photos is kept: consider stripping it for POPIA).

## Web protections

- Next.js server actions check the `Origin` header (CSRF). Session cookies are SameSite=Lax. Logout is POST-only.
- Headers (`next.config.ts`): `X-Frame-Options: DENY`, `frame-ancestors 'none'`, nosniff, `Referrer-Policy: no-referrer`, HSTS, and a restrictive `Permissions-Policy`. A full script-src CSP is **not** set yet (would need nonces with Next.js).
- React escapes output. No `dangerouslySetInnerHTML`. Prisma parameterises SQL. The only raw SQL is tagged-template (parameterised).
- Errors: only `AppError` messages reach users. Unexpected errors are logged on the server and shown as a generic message.

## Secrets

All configuration is via environment variables (`.env` is git-ignored; `.env.example` has no secrets). The app does not log passwords, tokens or email bodies.

## POPIA considerations (not a compliance statement)

Implemented safeguards: tenant isolation, role-based access, least-privilege customer views, audited operator access, no silent support access, private files, password hashing, and an audit trail.
Still to be done before handling real personal information: a privacy notice and terms; an information officer and processes; a data-retention schedule and deletion/anonymisation tooling; data-subject access and export tooling (beyond printable job reports); an operator agreement for hosting and email providers; a breach-notification procedure; stripping EXIF location from photos; backups encryption and region decisions.

## Security tests that exist

See TESTING.md: cross-tenant reads, writes and references; role boundaries; customer boundaries; draft quote visibility; forged, expired, revoked, reused and tampered links; concurrent duplicate decisions; unsafe uploads; attachment read permissions; invitation reuse and expiry; access revocation; last-owner protection; support access gating; subscription lock; audit-trail immutability.
