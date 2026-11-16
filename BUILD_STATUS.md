# Build status

Last updated: 2026-11-16. Legend: ✅ implemented and tested · 🟡 implemented, partially tested or with known limits · ❌ not started

## Final acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Company can create an account and complete onboarding | ✅ | e2e journey; onboarding checklist from real records |
| 2 | Company data is securely separated | ✅ | integration "tenant isolation" plus e2e rival-company test; composite FKs |
| 3 | Users can be invited and assigned roles | ✅ | e2e (technician invite); integration (roles, single-use, expiry, revocation) |
| 4 | A client and site can be created | ✅ | e2e |
| 5 | A request can be logged with evidence | ✅ | e2e (photo upload) |
| 6 | An assessment can be recorded | ✅ | e2e (technician on phone viewport) |
| 7 | A valid quotation can be produced and reviewed | ✅ | e2e (VAT totals match server); unit money tests |
| 8 | Authorised customers can approve or reject | ✅ | e2e (link approve and reject); integration (portal, internal, concurrency, forgery) |
| 9 | An approved job can be assigned | ✅ | e2e |
| 10 | Technician records work and evidence | ✅ | e2e |
| 11 | Completion can be submitted for verification | ✅ | e2e (evidence required) |
| 12 | Authorised customer can approve completed work | ✅ | e2e (link plus signature); integration (portal, in person) |
| 13 | Job can be closed or reopened appropriately | ✅ | e2e plus integration closure rules |
| 14 | Complete audit history | ✅ | e2e timeline plus report; DB trigger blocks edits |
| 15 | Main workflow passes meaningful automated tests | ✅ | 46 integration/unit plus 3 e2e, all green |
| 16 | Can be installed, configured and deployed from the docs | 🟡 | Local setup verified in this environment. A production deployment has **not** been performed. Email and object storage need configuration or work (see below) |

**Production readiness: NOT yet.** It needs a password-reset flow, live email, a decision on storage, a security review, and POPIA work (below).

## Modules

| Area | Status | Notes |
|---|---|---|
| Auth (register, login, logout, sessions, password change) | ✅ | |
| Password reset / email verification / MFA | ❌ | Highest-priority gap |
| Multi-tenancy, memberships, workspace switch | ✅ | |
| Roles and permission matrix, customer scoping | ✅ | |
| Invitations (staff and customer users) | ✅ | Link shown once plus queued email |
| Company settings, branding, VAT, priority rules | ✅ / 🟡 | Priority-rules and logo UI are not covered by e2e (service-tested) |
| Demo workspace | ✅ | Manually verified (screenshots); built by real services |
| Customers / sites / locations / assets plus asset history | ✅ / 🟡 | Asset pages not in e2e |
| Requests, triage, priority change, emergency | ✅ | |
| Assessment | ✅ | |
| Direct authorisation without quote | ✅ | |
| Quotes: draft, submit, revise, versions, variation, frozen | ✅ | |
| Review links (quote and completion), portal, in-person, internal | ✅ | |
| Assignment and planning dates | ✅ | No calendar view (by design for v1) |
| Execution: start, updates, hold/resume, clarification, additional work | ✅ | |
| Completion with evidence, sign-off, closure, reopen, cancel | ✅ | |
| Audit trail (append-only) and printable job report | ✅ | PDF via browser print, not server-generated |
| In-app notifications | ✅ | |
| Email outbox and worker | 🟡 | Retry/dedupe tested. **Real provider transport untested** |
| Overdue alerts | ✅ | |
| Dashboard (live counts, filters, next action) | ✅ | |
| Reports with metric definitions | ✅ / 🟡 | App-level aggregation, capped at 5k rows |
| Subscriptions: trial/grace/lock, plan limits, operator console | ✅ / 🟡 | No payment provider (by design) |
| Support access (grant, audited read-only) | ✅ | Console UI not in e2e (service-tested) |
| PWA: manifest (tenant-branded), install, offline page | 🟡 | Not tested on real devices. **No offline data entry** |
| File storage | 🟡 | Local disk only. S3 driver not written |
| Rate limiting | 🟡 | In-memory, single instance only |
| Accessibility | 🟡 | Good practices followed, no formal audit |

## Known issues / limitations

1. Next.js 15.5 caveat: after a successful form action the page does a full reload (or navigation). This is intentional (see AI_HANDOVER.md), and it costs a page load per action.
2. Rate limiter and file storage are single-instance.
3. No antivirus scanning or EXIF stripping on uploads.
4. No script-src Content-Security-Policy (only framing/base/form/object restrictions).
5. Timezone display is fixed to Africa/Johannesburg. Dates entered in forms are interpreted in server time.
6. `PriorityRule.responseHours` is stored but not yet measured or alerted (only completion due dates are used).
7. The planned-start date does not trigger any reminder.
