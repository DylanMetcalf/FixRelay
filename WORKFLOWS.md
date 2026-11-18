# Workflows

Source of truth: `src/server/workflow.ts` (`TRANSITIONS`, `nextAction`). Enforcement: `jobs.ts → move()` (a guarded `UPDATE … WHERE status = <status read>`) plus a permission check on every action.

FixRelay is an **internal** maintenance system for a company with one or more sites. Someone on site reports a fault; the maintenance team either fixes it **in-house** or gets **contractor quotes**; the job is tracked until the person who reported it confirms it is fixed.

## The two routes

```
                         ┌── IN-HOUSE ──► APPROVED ──► ASSIGNED (technician) ──► IN_PROGRESS ──┐
NEW ──► ASSESSING ──► ASSESSED                                                                  ├──► AWAITING_VERIFICATION ──► VERIFIED ──► CLOSED
                         └── CONTRACTOR ──► QUOTING ──► (AWAITING_APPROVAL) ──► ASSIGNED (contractor) ──┘        │ not fixed              │ reopen
                                               ▲               │ not approved                                     ▼                        ▼
                                               └───────────────┘                                              IN_PROGRESS               ASSIGNED
Any open state except AWAITING_VERIFICATION / VERIFIED ──► CANCELLED (terminal).   ASSIGNED / IN_PROGRESS ⇄ ON_HOLD.
```

| From | Allowed to |
|---|---|
| NEW | ASSESSING, APPROVED (emergency in-house), CANCELLED (incl. rejecting a public report) |
| ASSESSING | ASSESSED, CANCELLED |
| ASSESSED | QUOTING (request or capture a quote), APPROVED (in-house), CANCELLED |
| QUOTING | AWAITING_APPROVAL (over the chooser's limit), APPROVED (switch to in-house), CANCELLED. Approving a quote goes QUOTING → APPROVED → ASSIGNED in one transaction |
| AWAITING_APPROVAL | APPROVED (→ ASSIGNED to the contractor), QUOTING (not approved), CANCELLED |
| APPROVED | ASSIGNED, CANCELLED |
| ASSIGNED | IN_PROGRESS, ON_HOLD, AWAITING_VERIFICATION (contractor completion), CANCELLED |
| IN_PROGRESS | AWAITING_VERIFICATION, ON_HOLD, CANCELLED |
| ON_HOLD | ASSIGNED, IN_PROGRESS (back to where it was), CANCELLED |
| AWAITING_VERIFICATION | VERIFIED, CLOSED (only when reporter confirmation is off), IN_PROGRESS (not fixed) |
| VERIFIED | CLOSED |
| CLOSED | ASSIGNED (reopen) |

`Job.route` is `UNDECIDED` until the manager chooses, then `IN_HOUSE` or `CONTRACTOR` (a CHECK constraint ties `contractorId` to the contractor route).

## Business rules

**Reporting a fault**
- Any member with `job.create` reports from the app (`/requests/new`): site → location → equipment pickers that narrow as you choose. Members limited to certain sites only see those sites.
- **QR codes**: every site has a secret `publicToken`. `/sites/:id/qr` prints one label for the site, each location and each piece of equipment (`/r/<token>?l=<location>&a=<asset>`). Scanning it as a signed-in member opens the normal form pre-filled; otherwise:
- **Reporting without an account** (off by default; Settings → "Anyone with a site link or QR code can report"): name and phone are required, email optional (they get the reference number). The job is created with `source = PUBLIC_LINK`, no requester and reporter confirmation **off** (the manager checks the work instead). Public reports show on the dashboard as "Public reports to screen"; a manager accepts or rejects them. Rate limited per IP (10/hour) and per site (200/day). "Replace link" on the site rotates the token and kills every printed QR code.
- `dueAt` = reported + the priority's completion hours. Priority is urgency only, never authority.

**Assessment**: a manager sends it to a technician (or the unassigned queue) or assesses it directly. The assessment says whether the in-house team can fix it or a contractor is needed. That is advice: the manager decides the route.

**In-house route**: "Fix it in-house" (optional note) → APPROVED → assign a lead technician (+ helpers, planned dates, instructions) → start → updates with time and materials → "Work finished": what was done plus **at least one after-photo or test document**.

**Contractor route**
- **Request quotes**: choose contractors from the directory, describe the work, optional deadline. Each contractor gets an email with a personal **secure link** (`/c/<token>`, 256-bit, only the SHA-256 stored, expires at the end of the deadline day or after 14 days). The link page shows the work to quote for, the fault, the location and the site's photos. It needs a confirmed email address on the requester's account.
- **Capture a quote received by email/phone**: from ASSESSED or QUOTING, no link is sent.
- **Quotes**: one price excl. VAT; 15% VAT is added only if the contractor is VAT registered; integer cents. A new quote from the same contractor supersedes their previous one (all versions are kept and frozen by a trigger).
- **Compare**: quotes sorted by total, cheapest marked; who has not responded yet; the company rules and your own limit are shown.
- **Spending authority** (Settings → Approval rules): Owner unlimited; Approver up to the approver limit (empty = unlimited); Maintenance manager up to the manager limit. Choosing a quote within your limit approves it; above it, it is **sent for approval** to everyone (for that site) whose limit covers it and they see it under "Needs your approval".
- **Several quotes rule**: above the threshold you need `minQuotes` quotes, or a written reason (stored on the job and in the history).
- **PO number**: optional, or required by the rules.
- **On approval** (one transaction): the decision is recorded; other quotes are rejected and their links closed (contractors see a read-only "closed" page and get a "not selected" email); the job becomes ASSIGNED to the contractor with the approved value and PO; the contractor gets an **appointment email** with a completion link (90 days).
- **Contractor completion**: through the completion link, what was done plus **at least one photo**; single use. A manager can also record it for them (photos received by email), or resend the link.
- Switching to in-house while quoting withdraws all open quotes and tells the contractors.

**Confirming it is fixed**
- If `reporterConfirmation` is on (company default, can be changed per job), the person who reported it answers **"Is it fixed?"** (dashboard card "Is it fixed? Please confirm"). A manager can confirm instead, but must give a reason, or capture the reporter's **signature on the technician's device**.
- "Not fixed" (comment required) sends the job back to IN_PROGRESS; for contractor jobs the contractor automatically gets a fresh link to put it right.
- If confirmation is off, the manager checks the work and closes in one step.

**Close / reopen / cancel**: close from VERIFIED (or directly when confirmation is off). Reopen needs a reason → ASSIGNED; contractor jobs get a new completion link. Cancel needs a reason and is not allowed once work is awaiting confirmation.

## The maintenance work requisition (digital form)

Every job *is* a numbered maintenance work requisition, filled in automatically as it moves along. The printable form (`/jobs/:id/report`, "Requisition form" on the job page) follows the paper version line by line:

| Paper form | Filled in from | When |
|---|---|---|
| Requisition number (e.g. 12600) | `Job.reference` = company prefix + number (Settings: prefix may be empty; "next number" continues a paper book and can only go up) | Reported |
| Date reported / Reported time | `reportedAt` (automatic) | Reported |
| Area | Site · location · equipment | Reported |
| Projects ☐ | `Job.isProject` ("This is a project (planned work, not a breakdown)") | Reported |
| Description of fault / breakdown | Title and description | Reported |
| Submitted by + Signature | Reporter (app user, or name/phone from the QR page) + `REPORTED` signature | Reported |
| Submitted to + Signature | The maintenance person who accepts it ("Send for assessment" or "Assess it myself") + `RECEIVED` signature | Received |
| Maintenance start date & time | `startedAt` (automatic on "Start work") | Started |
| Maintenance report | The completion's "What was done?" (+ contractor, PO, approved value) | Completed |
| For food hall use: tools out = tools in, area clean Y/N | `Completion.toolsAndAreaOk` — asked (and required) only for locations marked **food-handling area** | Completed |
| Root cause boxes + lines | `Completion.rootCauses` (at least one) + `rootCauseNotes` | Completed |
| Date / time completed, By + Signature | `completedAt` (automatic) + `COMPLETED` signature (technician, or the contractor through their link with their name) | Completed |
| Confirmed by originator + Date + Signature | The reporter answers "Is it fixed?" in the app, or signs on the technician's device (`ORIGINATOR`) | Confirmed |
| Confirmed by manager + Date + Signature | "Sign off and close" (`MANAGER`) | Closed |

Quote sign-off is also signed (`APPROVAL`) and shown on page 2 with the quotes, assessment, work log, photos and full history.

**Signatures**: drawn on screen (finger or mouse) and stored as PNG with the signer's name, the server's date and time, and the IP for public/contractor signatures (`JobSignature`, append-only by trigger). Settings → "Require signatures on every line" makes each step refuse to continue without one; otherwise signing is optional. Signing on a staff device for the reporter is always required.

## Who decides what

| Decision | Channel | Recorded as |
|---|---|---|
| Spend approval | Signed-in Owner / Approver / Manager within their limit | `PORTAL`, user, amount, PO, exception reason |
| Not approved | Approver | comment required, job back to QUOTING |
| Fixed / not fixed | The reporter (signed in) | `PORTAL` |
| Fixed / not fixed | Reporter's name + drawn signature on a staff device | `IN_PERSON`, recorded by staff |
| Fixed / not fixed | Manager instead of the reporter | `INTERNAL`, reason required |

Decisions are append-only (trigger) and unique per quote / completion version.

## Notifications

| Event | Who |
|---|---|
| Fault reported | Managers; public reports also send the reporter an acknowledgement email if given |
| Sent for assessment | Named assessor |
| Assessed / quote received | Managers |
| Sent for approval | Approvers whose limit covers the amount (and who cover that site) |
| Approved / not approved | Managers; contractor appointment email; "not selected" emails |
| Assigned | Lead and additional technicians |
| Clarification / more work needed / on hold | Managers |
| Work finished | The reporter ("Is it fixed?") or managers when confirmation is off |
| Not fixed | Managers, technician or contractor (with a new link) |
| Overdue (worker) | Managers and the lead technician, once per job per day |

Every notification has a `dedupeKey`. Emails go through the outbox (retries with backoff); bodies containing links are cleared after sending. Addresses on reserved domains (`example.com`, `*.test`, `*.example`, …) are never sent.
