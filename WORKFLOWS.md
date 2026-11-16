# Workflows

Source of truth: `src/server/workflow.ts` (`TRANSITIONS`). Enforcement: `jobs.ts → move()` (guarded update) plus per-action permission checks.

## Job lifecycle

```
NEW ──► ASSESSING ──► ASSESSED ──► QUOTING ──► AWAITING_APPROVAL ──► APPROVED ──► ASSIGNED ──► IN_PROGRESS ──► AWAITING_VERIFICATION ──► VERIFIED ──► CLOSED
 │                       │            ▲               │ (rejected /            ▲          │  ▲           │  ▲                 │ (rejected)                  │
 │ (emergency, direct    │ (no quote  └───────────────┘  revised)              │          ▼  │           ▼  │                 └──► IN_PROGRESS           │ reopen
 │  authorisation)       │  needed)                                             │        ON_HOLD ◄──────────┘                                               ▼
 └───────────────────────┴───────────────────────────────────────────────────► APPROVED                                                             ASSIGNED
Any open state except AWAITING_VERIFICATION / VERIFIED ──► CANCELLED (terminal)
```

| From | Allowed to |
|---|---|
| NEW | ASSESSING, APPROVED (emergency only), CANCELLED |
| ASSESSING | ASSESSED, CANCELLED |
| ASSESSED | QUOTING, APPROVED, CANCELLED |
| QUOTING | AWAITING_APPROVAL, APPROVED, CANCELLED |
| AWAITING_APPROVAL | APPROVED, QUOTING, CANCELLED |
| APPROVED | ASSIGNED, CANCELLED |
| ASSIGNED | IN_PROGRESS, ON_HOLD, CANCELLED |
| IN_PROGRESS | AWAITING_VERIFICATION, ON_HOLD, CANCELLED |
| ON_HOLD | ASSIGNED, IN_PROGRESS (returns to the state it came from), CANCELLED |
| AWAITING_VERIFICATION | VERIFIED, CLOSED (only when sign-off is not required), IN_PROGRESS (rejected) |
| VERIFIED | CLOSED |
| CLOSED | ASSIGNED (reopen) |
| CANCELLED | — |

## Business rules

**Logging**
- Anyone with `job.create` (staff, client representative, requester) can log a request. Customer-side users can only log requests for their own client.
- The site, location and asset must belong to the chosen customer (and tenant).
- `dueAt` = reported + the priority's completion hours. Assignment with a planned end date overrides it.
- Priority never authorises anything. It is only urgency (the form states this).
- New requests notify all managers. A request without a responsible manager is counted as "unowned" on the dashboard; the first manager to act becomes `ownerId`.

**Assessment**
- A manager sends the request for assessment (optionally naming an assessor) or assesses it directly.
- Technicians can only assess jobs they are assigned to.
- The assessment records whether a quote is required. That is advisory: the manager then prepares a quote or authorises directly.

**Authorising without a quote (explicit rule)**
- Manager only, with a **mandatory reason** that is stored on the job and in the audit trail.
- Allowed from ASSESSED or QUOTING (any open draft quote is withdrawn), or from NEW **only for emergency requests**.

**Quotations**
- ORIGINAL quote: started from ASSESSED (the job moves to QUOTING). VARIATION quote: for additional work while a job is ASSIGNED, IN_PROGRESS or ON_HOLD (the job status does not change).
- Only DRAFT quotes are editable. Submitting needs at least one line, a scope, and a validity date not in the past. Totals are recomputed on the server.
- Revision creates version n+1 as a new DRAFT copy. A SUBMITTED predecessor becomes SUPERSEDED and its links are revoked. A REJECTED one stays REJECTED. APPROVED quotes can never be revised or changed.
- A quote cannot be approved after its validity date (end of that day). Review links never outlive the quote's validity.
- Rejection requires a comment. A rejected original quote returns the job to QUOTING.

**Customer decisions (quotes and completed work)**

| Channel | Who | Recorded as |
|---|---|---|
| Review link | Anyone holding the link (no account); must type their name | `LINK`, link id, recipient email, IP |
| Portal | Signed-in CLIENT member of that customer | `PORTAL`, user id, IP |
| In person | Staff device; the customer's name and drawn signature are mandatory | `IN_PERSON`, recorded by staff id |
| Internal | Manager records a decision received another way (PO, phone); a comment explaining how is mandatory | `INTERNAL`, recorded by staff id. Allowed for quotes only, not for completion sign-off |

Exactly one decision per quote version or completion version (DB unique, plus guarded updates).

**Execution**
- Only an ASSIGNED job can be started (by an assigned technician or a manager).
- Updates are timestamped activity, which supports multiple visits. "Additional work" and "clarification" updates notify managers.
- Hold requires a reason. Resume returns to the previous state.

**Completion**
- Requires IN_PROGRESS, a description of the work performed, **at least one AFTER photo or TEST_DOCUMENT** not already bound to an earlier completion, and **no variation quote still in DRAFT/SUBMITTED**.
- Evidence attachments are bound to that completion version (`completionId`).
- Customer-side rejection sends the job back to IN_PROGRESS, and a new completion version is needed.

**Closure**
- If `customerSignoffRequired` (company default, overridable per job until work is submitted; changes are audited), the job can only close from VERIFIED, which needs a non-INTERNAL customer approval of the **latest** completion.
- If not required, a manager can "verify and close" from AWAITING_VERIFICATION; this records an INTERNAL decision.

**Reopen**: manager only, reason required. It goes to ASSIGNED, clears the completed/closed dates and increments `reopenCount`.

**Cancel**: manager only, reason required. It is not allowed once work is awaiting verification or verified. Open quotes are withdrawn and their links revoked.

## Notifications

| Event | Who is notified |
|---|---|
| Request created | Managers (except the creator) |
| Sent for assessment | Named assessor |
| Assessed | Managers |
| Quote submitted | Client representatives of that customer (in-app plus email) |
| Quote approved / rejected | Managers |
| Assigned | Lead and additional technicians |
| Additional work / clarification | Managers |
| Put on hold | Managers |
| Completion submitted | Managers plus client representatives (if sign-off is required) |
| Completion approved / rejected | Managers, lead technician, submitter |
| Overdue (worker) | Managers plus lead technician, once per job per day |
| Closed / cancelled / reopened | Requester and technicians (reopened: also managers) |

Each notification has a `dedupeKey` of the form event + user, so it is never sent twice. Review-link and invitation emails are queued in the outbox, and message bodies are cleared after sending (they contain secrets).
