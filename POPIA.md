# POPIA review (engineering self-assessment)

> This is an engineering review of how Resultra handles personal information, mapped to the eight conditions for lawful processing in the Protection of Personal Information Act 4 of 2013. **It is not legal advice and not a compliance certificate.** Have a South African privacy practitioner review it together with the privacy notice (`/privacy`) before launch.

## Roles
- The **subscribing company** (tenant) is the *responsible party* for the staff, contractor, site, job and fault-reporter data it enters or collects. **Resultra's operator** is its *operator* (s21: needs a written operator agreement).
- For sign-up account data, Resultra's operator is the responsible party.

## Personal information processed
Names, emails and phone numbers of staff, contractor contacts and (when public QR reporting is on) people who report faults without an account; site addresses; job descriptions and photos (which may show people or places); drawn signatures; IP address and time of contractor link submissions; sign-in sessions. **No special personal information** (s26) is required by the product. Users are told not to upload it. **No children's information.**

## Conditions → controls

| POPIA condition | What the software does | Operator still must |
|---|---|---|
| 1. Accountability (s8) | Audit trail of every job change, support access and data export; owner controls access | Appoint and register an Information Officer; keep this review current |
| 2. Processing limitation (s9–12) | Collects only what the workflow needs; public reporters give only a name and phone number (email optional), and the form says what they are used for; public reporting is off by default; only essential sign-in cookie | Confirm lawful basis per data type in the privacy notice |
| 3. Purpose specification (s13–14) | Purpose: managing maintenance jobs. Retention purge: emails 90 days, notifications ≤ 12 months, tokens/sessions on expiry (`purgeRetention`) | Decide and implement the post-cancellation deletion period for tenant data |
| 4. Further processing (s15) | No analytics, advertising or sale of data in the code | Keep it that way; review any new integration |
| 5. Information quality (s16) | Owners and managers can correct contractor, site, equipment and job details; history shows who changed what | — |
| 6. Openness (s17–18) | Privacy notice and terms pages (templates) linked from every public page | Complete the templates with company details and providers |
| 7. Security safeguards (s19–22) | Tenant isolation (composite keys plus tests); role-based and site-scoped access; contractor links scoped to one job and one contractor; bcrypt passwords; opaque, revocable sessions; email verification and secure password reset; rate limits shared across servers; private files served only after permission checks; **ClamAV scanning**; **EXIF/GPS stripped from photos**; PDF active content blocked; append-only audit tables; security headers and CSP; operator access only by time-limited, audited tenant grant | Host in an encrypted, backed-up environment; sign operator agreements with hosting/email/storage providers; write a breach-notification procedure (s22: notify the Regulator and data subjects); run an independent penetration test |
| 8. Data subject participation (s23–25) | **Full company export** for owners (used to answer access requests) (works even when the subscription has lapsed); records can be corrected | Define how deletion/objection requests are handled (see below) |

## Cross-border transfers (s72)
Depends on where you host. If data leaves South Africa (e.g. EU region), record the safeguards (provider DPA plus standard contractual terms) in the privacy notice.

## Deletion requests (current process)
Business records (jobs, quotes, decisions) are generally kept as the maintenance company's lawful records. For a valid deletion request:
1. Edit or remove contact details on the contractor record (and mark it inactive), or the reporter details on a public report.
2. Deactivate the person's membership (access ends immediately).
3. Free-text fields (job descriptions, notes) may contain names. Edit drafts. Submitted quotes and the audit trail are intentionally immutable, so record the request and the legal reason for retention.
An automated "anonymise person" tool is on the roadmap.

## Known gaps (tracked in BUILD_STATUS.md)
No MFA yet (recommended for owners and the platform operator); no automated anonymisation tool; post-cancellation deletion schedule not implemented; independent security test not yet done.
