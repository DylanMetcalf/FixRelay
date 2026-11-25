# Security

> Not security-certified and **not** certified POPIA compliant. An independent security review and a POPIA assessment are required before production use with real personal data.

## Authentication (`src/server/auth.ts`)

- Email + password. Passwords are 10–72 characters (the bcrypt limit) and hashed with **bcrypt cost 12** (`BCRYPT_COST`, lowered only in tests).
- Unknown-email logins run a dummy bcrypt comparison, so response time does not reveal which emails exist.
- Sessions are opaque random 256-bit tokens in an **httpOnly, SameSite=Lax, Secure (production)** cookie. Only the **SHA-256** of the token is stored. They last 30 days and are revocable server-side.
- Every request reloads the session **and the membership**. Deactivating a member or revoking support access takes effect on the next request.
- Changing a password revokes all other sessions. Logout deletes the session row (POST `/api/logout`).
- Rate limits (shared Postgres limiter, `src/lib/rate-limit.ts`, works across instances): login (20 per 10 min per IP, 8 per email), registration (10 per hour per IP), password reset (10 per hour per IP, 3 per email), invitation acceptance, review-link decisions, verification resends, exports.
- Client IP = the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right (default 1). The leftmost entries are client-controlled and are ignored, so rate limits cannot be bypassed with a fake header.
- **Password reset**: 256-bit single-use token (hash stored), 60 minutes, only the newest works, same response whether or not the email exists, weak passwords rejected before the token is used, completion signs out every device and emails a "password changed" notice.
- **Email verification**: 48-hour single-use link at sign-up (resendable). Unverified accounts cannot send invitations or contractor quote requests. Accepting an emailed invitation counts as verified.
- Session cookie `__Host-fr_session` in production (HTTPS-only, host-locked). Signing in replaces any previous session in that browser.
- Forms always POST (never GET) so credentials cannot end up in URLs, even if submitted before scripts load.
- **Not implemented yet:** MFA (recommended for owners and the platform operator).

## Authorisation (`src/server/permissions.ts`)

All checks are server-side in the service layer. The UI only hides controls.

| Permission | Owner | Manager | Approver | Technician | Stores | Reports faults only | Platform support* |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| org.manage (settings, branding, approval rules, support grants) | ✓ | | | | | | |
| team.manage (invite staff, roles, sites, deactivate) | ✓ | | | | | | |
| team.view | ✓ | ✓ | | | | | ✓ |
| sites.manage (sites, locations, equipment, QR codes, invite fault reporters) | ✓ | ✓ | | | | | |
| sites.view | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| contractors.manage / contractors.view | ✓ / ✓ | ✓ / ✓ | – / ✓ | | | | – / ✓ |
| job.create (report a fault) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| job.viewAll (within the member's sites) | ✓ | ✓ | ✓ | | | | ✓ |
| job.manage (triage, route, quotes, assign, hold, cancel, close, reopen) | ✓ | ✓ | | | | | |
| job.assess / job.work | ✓ | ✓ | | ✓ (assigned jobs only) | | | |
| quote.manage / quote.view | ✓ / ✓ | ✓ / ✓ | – / ✓ | | | | – / ✓ |
| spend.approve (limited by amount) | unlimited | manager limit | approver limit | | | | |
| spares.manage (issue, order and receive spares) | ✓ | ✓ | | | ✓ | | |
| reports.view | ✓ | ✓ | ✓ | | | | ✓ |

\*Platform support is read-only and needs a grant from the tenant (see below). "Reports faults only" members are free (not counted as seats).

**Row-level job visibility (`jobScope`)**, which every job query uses:
- Owner / Manager / Approver: all jobs in the tenant, limited to `Membership.siteIds` when set. Technician: jobs they lead, are added to, or reported. Stores: jobs that need spares (any spares status other than "none"), within their sites, plus jobs they reported. Fault reporters: only the jobs they reported. **Everyone** also sees jobs handed to them as the responsible person (`ownerId`). **Department managers** see their departments' jobs; technicians and stores in a department see that department's jobs.
- **Handover** is allowed for maintenance managers and the manager of the department currently responsible (`canHandOver`); handovers are append-only (database trigger).
- **Pending registrations** (`Membership.status = PENDING`, `active = false`) give no company context at all: the session loads with no access until an administrator approves, and approval requires a confirmed email address. Registration codes only create requests; they are short-lived, revocable and rate-limited (8 registrations per IP per hour).
- Approvals are offered only to members whose limit covers the amount and who cover that site (`approverIdsFor`).
- Fault reporters see the fault, the progress status and the work evidence (after photos, test documents, signature), not assessments, quotes, prices, internal notes or internal photos. Technicians never receive pricing.
- Cross-tenant and out-of-scope IDs return **404 Not Found** (never 403), so they don't reveal that records exist.

**Subscription lock**: write permissions are refused when a subscription is suspended or expired past grace. Reading and printing stay available.

## Tenant isolation layers

1. Every service query filters on `ctx.orgId`. `ctx` comes only from the server-side session.
2. Composite foreign keys `(orgId, id)` stop cross-tenant references even if a query bug slipped through.
3. A session can only be switched to an organisation the user actively belongs to. A forced `activeOrgId` with no membership falls back to the user's own company (tested).
4. Automated tests try reads, writes, references, forged decisions, links and files across tenants (see TESTING.md).

## Platform operator vs tenant administrator

- `User.isPlatformAdmin` (the SaaS operator) is **not** a tenant role. Platform admin (`/platform`) shows **account metadata only**: companies, sites, main contacts, users with roles and status, departments, onboarding progress, subscription, email delivery counts and failures (recipient and error, never subjects or bodies) and server errors. It never shows jobs, quotes, photos, reports or documents.
- The platform owner can create customer companies (company, first site, departments, and a secure administrator invitation). Creation is written to the company's audit trail.
- To view a tenant, the tenant's **Owner must grant support access** (with a reason; 4h, 24h or 72h maximum; revocable). The operator then enters a **read-only** session, and the entry is written to the tenant's audit trail. Expired or revoked grants end access immediately.

## Contractor links (`/c/<token>`)

- 256-bit tokens; only the SHA-256 is stored. A link is scoped to **one job and one contractor**. Only the newest link of each kind works.
- **Quote links** expire at the end of the quote deadline day (or after 14 days) and close when the job stops collecting quotes (award, switch to in-house, cancel) or the manager stops waiting for that contractor. A closed link still shows a read-only "closed" page, never other contractors' prices.
- **Completion links** (90 days) work only while the job is assigned to that contractor and are single use; a new one is issued for rework or reopening.
- Link pages show only that job's fault details, location, the site's fault photos and (after appointment) the PO and approved value. File reads via a link are checked against that job and kind.
- Quotes or completions submitted via a link are recorded as "<contractor> (contractor, via secure link)" with time and IP. **Possession of the link is the credential**; the page says the link is personal to the contractor.

## One-person jobs

- Taking a job as a one-person job requires `job.work` and the company setting; the server re-checks both. The doer cannot sign off their own work when the company requires manager sign-off (closing still needs `job.manage`). When sign-off is off, the automatic close is recorded as an `INTERNAL` decision naming the person, so the history shows exactly who closed it and why.

## Public sandbox

- `/demo` creates a guest user (reserved `.invalid` address, unknown random password, refused at password sign-in) and a demo company owned by that guest; the session cookie is the only way in. `User.guestExpiresAt` (24 h) makes `loadSession` refuse the session after expiry; the background worker then archives the company, deactivates memberships and deletes the sessions.
- Each visitor gets their own company: visitors never see each other's data. Demo companies never queue email.
- Abuse limits: 5 sandboxes per IP per hour and 300 per day overall (shared Postgres rate limiter).

## Demo companies and "view as"

- Demo companies are separate organisations flagged `isDemo`, built from synthetic data. Sample people have reserved `.invalid` addresses, an unknown random password and are refused at sign-in.
- "View as" (`Session.actAsUserId`) is honoured by `loadSession` **only** when the session's company is a live demo company, the real user is an **owner** of it, and the target is one of its sample people. In any other company the value is ignored, and `setViewAs` refuses it (tested with forged session values).
- Demo companies never queue email; "reset demo" archives the old demo company (no deletes of append-only audit rows) and builds a new one.

## Site report links and QR codes (`/r/<code>`)

- Each site, area and machine has a short random code (10 characters from a 31-character alphabet, about 50 bits, not sequential) used in its QR codes; no database ids appear in public links. Older `/r/<siteToken>` links still resolve until the site link is replaced. When reporting without an account is **off** (default), the page only sends people to sign in. When on, anyone with the link can submit a fault for that site and nothing else: they cannot see any job, and the job is marked as a public report for a manager to screen.
- Abuse controls: rate limits per IP (10/hour) and per site (200/day); a name is required (contact details optional); a hidden spam-trap field (bots get a fake "thank you" and nothing is stored); one-time submission keys so repeated submits create one report; images only, decoded, re-encoded and virus-scanned; text is always rendered as text (HTML is not interpreted, tested). "Replace link" rotates the token so printed codes stop working.
- `Referrer-Policy: no-referrer` site-wide so tokens do not leak to other sites. Email bodies containing links are cleared from the outbox once sent.

## Job documents (PDF)

- Generated per request from the permission-checked job loader; never stored; `Cache-Control: private, no-store`; 401/403/404 as for pages. Prices only for people with price access; history refused to people who only report faults.
- Photos are read from private storage on the server and embedded; no public URLs.
- The QR code / link on documents points to the job page, which requires signing in with access. It carries no token.
- Only ManOp's own viewer page may frame the PDF (`X-Frame-Options: SAMEORIGIN` on that route only; `DENY` everywhere else).

## Error logging

Unexpected server errors are stored in `ErrorLog` (source, message, path, company and user ids) for the platform owner; request bodies, tokens and passwords are never logged.

## Signatures

Drawn signatures (PNG) are stored as evidence of acknowledgement, with name, time and decision. They are **not** advanced electronic signatures under the ECT Act, and the product makes no legal-equivalence claim (stated in job reports).

## Uploads (`services/attachments.ts`, `app/api/files`)

- Type is decided by **magic bytes**: JPEG, PNG, WebP, PDF only. Client filename and MIME type are ignored. SVG, HTML and executables are rejected.
- 10 MB per file (logo 1 MB, signature 300 KB), 100 files per job. Filenames are sanitised. Storage keys are random UUIDs.
- Files are never public. They are served only by `/api/files/:id` after tenant, job-scope and kind checks, with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Cache-Control: private, no-store`.
- **Antivirus**: with `CLAMAV_HOST`/`CLAMAV_SOCKET` set, every file is streamed to ClamAV (clamd INSTREAM). If ClamAV cannot be reached the upload is **refused** (fail closed).
- **PDF active content** (JavaScript, launch actions, embedded files, XFA, rich media, including hex-obfuscated names) is refused.
- **Images are decoded and re-encoded**: removes all EXIF/XMP metadata (GPS location, camera serials), applies rotation, caps at 2560 px, and rejects corrupt or decompression-bomb images (50 MP input limit).
- Storage: `db` (default) or private `s3` buckets. Files are always streamed through the app after permission checks.

## Web protections

- Next.js server actions check the `Origin` header (CSRF). Session cookies are SameSite=Lax. Logout is POST-only.
- Headers (`next.config.ts`): Content-Security-Policy (`default-src 'self'`; scripts, requests, images, fonts, workers and manifest from this site only; `frame-ancestors 'none'`; `form-action 'self'`; `object-src 'none'`), `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: no-referrer`, HSTS, `Permissions-Policy`. Inline scripts are allowed because Next.js needs them without nonces (roadmap: nonce-based CSP).
- The service worker caches only public versioned assets, never pages, API responses or files, so nothing leaks between users on a shared device.
- React escapes output. The only `dangerouslySetInnerHTML` is the QR label sheet, which inserts SVG generated by the `qrcode` library from our own URL (no user input reaches it). Prisma parameterises SQL. The only raw SQL is tagged-template (parameterised).
- Errors: only `AppError` messages reach users. Unexpected errors are logged on the server and shown as a generic message.

## Secrets

All configuration is via environment variables (`.env` is git-ignored; `.env.example` has no secrets). The app does not log passwords, tokens or email bodies.

## Self-audit
See AUDITS.md (five audits plus the e2e findings) and POPIA.md.

## POPIA considerations (not a compliance statement)

Implemented safeguards: tenant isolation, role-based access, least-privilege views for fault reporters and contractors, audited operator access, no silent support access, private files, password hashing, and an audit trail.
Still to be done before handling real personal information: a privacy notice and terms; an information officer and processes; a data-retention schedule and deletion/anonymisation tooling; data-subject access and export tooling (beyond printable job reports); an operator agreement for hosting and email providers; a breach-notification procedure; stripping EXIF location from photos; backups encryption and region decisions.

## Security tests that exist

See TESTING.md: cross-tenant reads, writes and references; role and site boundaries; approval limits; contractor link scope; forged, expired, revoked, reused and tampered links; concurrent duplicate decisions; unsafe uploads; attachment read permissions; invitation reuse and expiry; access revocation; last-owner protection; support access gating; subscription lock; audit-trail immutability.
