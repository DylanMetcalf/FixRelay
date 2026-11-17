# Product roadmap

Ordered by commercial value and dependency. Keep the product narrow: request-to-closure maintenance management.

## Done in round 2 (2026-11-17)
Password reset and email verification · SMTP/Resend email with branded HTML · Postgres/S3 storage · shared rate limiter · ClamAV and PDF safety · EXIF/GPS stripping · retention purge · company and customer data export · privacy/terms templates · brand, landing page and installable PWA · response-time, quote win-rate and rework metrics · jobs CSV.

## Next (needed before a paid launch)

| # | Item | Why |
|---|---|---|
| 1 | **Live deployment** plus a **live email provider** account (domain SPF/DKIM) | Customers must receive links |
| 2 | **Independent security test** and **legal review** (privacy, terms, POPIA operator agreements) | Launch readiness |
| 3 | **MFA** for owners and the platform operator | Account takeover protection |
| 4 | **Billing adapter** (Paystack or PayFast) plus a self-serve plan page | Self-service revenue |
| 5 | Error tracking and uptime monitoring | Operational safety |
| 6 | Server-generated **PDF** quotes and job reports | Professional attachments |

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
