# Product roadmap

Ordered by commercial value and dependency. Keep the product narrow: fault-to-closure maintenance management for a company's own sites.

## Done: internal site model (2026-11-17)
Sites with QR codes and optional reporting without an account · in-house or contractor route · contractor directory and secure-link quotes · comparison · spending limits by role, send for approval, three-quote rule, PO numbers · contractor appointment and completion links · reporter confirms it is fixed · insights by site, equipment and contractor.

## Done in round 2 (2026-11-17)
Password reset and email verification · SMTP/Resend email with branded HTML · Postgres/S3 storage · shared rate limiter · ClamAV and PDF safety · EXIF/GPS stripping · retention purge · company data export · privacy/terms templates · brand, landing page and installable PWA · response-time, quote win-rate and rework metrics · jobs CSV.

## Next (needed before a paid launch)

| # | Item | Why |
|---|---|---|
| 1 | **Own email domain** on the email provider (SPF/DKIM) and a production deployment | Contractors and reporters must receive emails reliably |
| 2 | **Independent security test** and **legal review** (privacy, terms, POPIA operator agreements) | Launch readiness |
| 3 | **MFA** for owners and the platform operator | Account takeover protection |
| 4 | **Billing adapter** (Paystack or PayFast) plus a self-serve plan page | Self-service revenue |
| 5 | Error tracking and uptime monitoring | Operational safety |
| 6 | Server-generated **PDF** job reports and purchase orders | Attachments for finance and contractors |

## Soon (strong customer value)

- **Planned / preventive maintenance**: schedules per equipment that create jobs automatically (services, inspections, certificates).
- Reminders to contractors before the quote deadline and for overdue completions (worker plus outbox).
- Contractor ratings after each job, compliance documents (insurance, safety file) with expiry alerts.
- Budgets per site with spend against budget on Insights.
- Calendar/day view of planned work per technician (still not an optimiser).
- Bulk CSV import of sites, locations, equipment and contractors.
- Per-user notification preferences; WhatsApp/SMS only after email is proven.
- CAPTCHA option for public QR reporting if spam appears.

## Later

- Offline-capable technician mode (IndexedDB queue plus conflict handling). Only with proper sync and permission design, and real-device testing.
- Accounting export (invoice-ready CSV / Xero / Sage). Not full accounting.
- Multiple currencies (the `Organisation.currency` field exists; formatting is ZAR-only).
- MFA for owners and managers; SSO for larger companies.
- Public API and webhooks.

## Explicitly out of scope

Generic business OS, no-code builders, contractor marketplace or contractor accounts, payroll/HR, full accounting, inventory/procurement, predictive maintenance, IoT, AI agents without a proven use case, native apps, microservices, many customisation settings.
