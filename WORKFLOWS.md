# Workflows

Source of truth: `src/server/workflow.ts` (`TRANSITIONS`, `nextAction`). Enforcement: `jobs.ts → move()` (a guarded `UPDATE … WHERE status = <status read>`) plus a permission check on every action.

ManOp is an **internal** maintenance system for a company with one or more sites. Someone on site reports a fault; the maintenance team either fixes it **in-house** or gets **contractor quotes**; the job is tracked until the person who reported it confirms it is fixed.

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

## Priority and spares

- **Priority** is chosen when the fault is reported (in the app and on the QR form): Critical (stopped or unsafe), High (affecting work), Medium (needs fixing soon, the default) or Low (when convenient). Managers are alerted with "CRITICAL:" for critical reports and can change the urgency later. Due dates follow the company's response times per priority.
- **Spares**: the assessment asks "Spares or parts needed?": no / yes, in stock (stores to issue) / yes, must be bought or quoted (stores to order), plus which spares. A technician on the job can also ask for spares later.
  - Spares status: none → in stock (to issue) or to buy → ordered (supplier and order number required, expected date optional) → ready.
  - Only Owner, Manager and Stores move spares on; each step is in the job history and notifies the technician and managers.
  - While an in-house job is approved, assigned, in progress or on hold and its spares are not ready, "What happens next" says Stores is responsible (issue, order, or waiting for delivery).
- **Jobs board**: Open now (anything not closed or cancelled, most urgent first) and History (closed and cancelled, newest first), filtered by priority with counts.

## Two ways a job runs: managed and one-person

| | Managed (default) | One-person job |
|---|---|---|
| Who | Maintenance management moves it along | One person (technician, manager or other maintenance staff) does it start to finish |
| Start | Report → screened → sent for assessment | Report with **"I'll fix it myself"**, or **"I'll fix it myself (one-person job)"** on a new or assessed report |
| Steps | Assess → (quote → approve) → assign → work → confirm fixed → close | Assigned to the person and started at once (NEW → APPROVED → ASSIGNED → IN_PROGRESS, all recorded) → work → complete with evidence → closed |
| Closing | Reporter confirms, manager closes | If someone else reported it, they still confirm. Otherwise a maintenance manager **signs it off**, or – when the company turns sign-off off – it **closes on completion** (recorded as a decision by the person who did it) |
| Overview | Dashboard, history, job card | The same, plus dashboard tiles *One-person jobs in progress* and *to sign off*; pill "One-person"; filter `mode=self` |

- Only people with the `job.work` permission (owner, maintenance manager, technician) may take one-person jobs; people who only report faults cannot.
- Company settings (Settings → Company): **allow one-person jobs** (default on) and **manager sign-off for one-person jobs** (default on).
- Evidence rules are the same for both: an after photo or test document, root cause, and the food-area check where it applies.
- `Job.mode` (`MANAGED` | `SELF`) records which way the job ran; events `job.self_started`, `job.completion_submitted`, `job.verified`/`job.closed`.

## Departments and handovers

- A **department** (Maintenance, Operations, Management, Finance …) groups people. It is separate from the **role** (what someone may do), the **job status** (stage of work) and the **job owner** (who is responsible right now).
- A job may belong to a department (chosen when reporting, by maintenance staff, or by handover).
- **Hand over** (job page → Department → *Hand over this job*): choose a department and/or a person and give the reason or next action. Allowed for maintenance managers and the manager of the department currently responsible. It records who passed it on, from/to department and person, the reason and the time (append-only `JobHandover`), updates the job's department and responsible person, adds a timeline entry, and notifies **only the receiver** (the person, or that department's managers; all its members if it has no manager).
- Department managers see their department's open work on the dashboard; technicians and stores in a department see its jobs.

## Duplicates, repeat faults and reopening

- Every new report (app or QR) is compared with open or recent (14 days) jobs at the same site: different area or machine means "not a duplicate"; otherwise word overlap of title and description, same machine/area, same category and reporting within 48 hours add up to a score. At 0.4 or more (with similar wording), the report is **flagged** (`duplicateStatus = FLAGGED`) and up to three likely originals are listed. Managers are told in the new-report notification.
- A manager reviews it on the job page (*Related reports*), comparing the original submissions, then either **links it** to the original (the report stays on record with its reporter and photos; if no work has started it is closed as cancelled "Duplicate of …") or marks **"Not a duplicate – keep separate"**. Nothing is merged or deleted automatically.
- **Repeat fault:** on a closed job, *The fault came back – report a repeat* opens the report form linked to it (`repeatOfId`); both jobs show the link and the earlier job's closure record is untouched.
- **Reopen** (managers): needs a reason; the original completion, verification and closure stay in the history.

## Public QR reporting

- Each site, area and machine has a short random code: `/r/{code}`. Old `/r/{token}?l=…` links keep working until the site's link is replaced (which replaces every code for that site).
- The reporter gives a description (an optional "kind of problem" tap), confirms the place, may add up to three photos, and gives a name; phone and email are optional. They get a reference number on screen (and by email if given).
- Protection: rate limits per IP and per site, a hidden spam-trap field, one-time submission keys (double taps never create two reports), images-only uploads that are decoded, re-encoded and virus-scanned.
- Signed-in members who scan a code go to the full report form with the place filled in. When public reporting is off, people are asked to sign in.

## Employee registration and approval

1. The site administrator creates a **registration code** (Settings → Registration codes) for the company or one site, valid for 1–365 days. Codes can be switched off or replaced at any time.
2. Employees open `/join`, enter the code, and give name, work email, password, department and optionally job title, phone and photo.
3. This creates an account (email not yet confirmed) and a **pending** request; administrators are notified. The person sees "Waiting for approval" and nothing from the company.
4. After the person confirms their email, the administrator approves (choosing roles, department and whether they manage it) or declines. The person is emailed either way. A code never grants access by itself.

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

Every job email links to the job (`APP_URL/jobs/<id>`); a signed-out person is sent to sign in and then returned to that job. Demo companies never send email.

| Event | Who |
|---|---|
| Fault reported | Managers; public reports also send the reporter an acknowledgement email if given |
| Sent for assessment | Named assessor |
| Assessed / quote received | Managers |
| Possible duplicate | Managers (in the new-report message) |
| Job handed over | The receiving person, or the receiving department's managers |
| Registration request | Administrators (owners) |
| Access approved / declined | The person who registered (email) |
| Duplicate linked | The reporter (if they have an account) |
| Spares needed (at assessment or mid-job) | Stores covering that site, and managers |
| Spares ordered / issued / received | Lead technician, helpers and managers |
| Sent for approval | Approvers whose limit covers the amount (and who cover that site) |
| Approved / not approved | Managers; contractor appointment email; "not selected" emails |
| Assigned | Lead and additional technicians |
| Clarification / more work needed / on hold | Managers |
| Work finished | The reporter ("Is it fixed?") or managers when confirmation is off |
| Not fixed | Managers, technician or contractor (with a new link) |
| Overdue (worker) | Managers and the lead technician, once per job per day |

Every notification has a `dedupeKey`. Emails go through the outbox (retries with backoff); bodies containing links are cleared after sending. Addresses on reserved domains (`example.com`, `*.test`, `*.example`, …) are never sent.
