# Product roadmap

Ordered by commercial value and dependency. Keep the product narrow: request-to-closure maintenance management.

## Next (needed before a paid launch)

| # | Item | Why | Depends on |
|---|---|---|---|
| 1 | **Password reset by email** and **email verification** at sign-up | Basic account recovery. Today a locked-out user needs the operator | A live email provider (2) |
| 2 | **Live email delivery** (verify the `http` transport with Resend/Postmark/SES; templates with tenant branding) | Quote and verification links reach customers | Domain plus SPF/DKIM |
| 3 | **Object storage driver** (S3-compatible, e.g. Cloudflare R2 or AWS af-south-1) | Required for PaaS and multi-instance hosting | — |
| 4 | **Shared rate limiter** (Postgres or Redis) | Required for more than one instance | — |
| 5 | **Billing provider adapter** (Paystack or PayFast) plus a self-serve plan page | Self-service revenue | 2 |
| 6 | **POPIA tooling**: privacy notice, data export per customer, retention/anonymisation jobs, EXIF stripping | Legal readiness | Compliance review |
| 7 | **Error tracking and uptime monitoring** | Operational safety | — |
| 8 | Server-generated **PDF** quotes and job reports (today: browser print → PDF) | Professional attachments in emails | 2 |

## Soon (strong customer value)

- Quote PDF attached to the review email; reminders for unanswered quotes (worker plus outbox).
- Response-time SLA tracking (`PriorityRule.responseHours` is stored but not yet measured or alerted).
- Calendar/day view of planned assignments per technician (still not an optimiser).
- Customer portal home: "awaiting your approval" list for client representatives.
- Bulk CSV import of customers, sites and assets.
- Per-user notification preferences; WhatsApp/SMS only after email is proven.
- Recurring/planned maintenance schedules (generate jobs from a schedule).

## Later

- Offline-capable technician mode (IndexedDB queue plus conflict handling). Only with proper sync and permission design, and real-device testing.
- Accounting export (invoice-ready CSV / Xero / Sage). Not full accounting.
- Multiple currencies (the `Organisation.currency` field exists; formatting is ZAR-only).
- MFA for owners and managers; SSO for larger customers.
- Public API and webhooks.

## Explicitly out of scope

Generic business OS, no-code builders, contractor marketplace, payroll/HR, full accounting, inventory/procurement, predictive maintenance, IoT, AI agents without a proven use case, native apps, microservices, many customisation settings.
