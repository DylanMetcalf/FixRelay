/**
 * The job lifecycle as an explicit state machine (single source of truth). Every status change goes through
 * `assertTransition` + a guarded UPDATE (services/jobs.ts `move`). Documented in WORKFLOWS.md.
 *
 * After assessment every job takes one of two routes:
 *   IN_HOUSE   – authorised → assigned to a site technician → work → evidence → confirmed fixed → closed
 *   CONTRACTOR – quotes requested → compared → approved (by amount) → contractor appointed → contractor
 *                submits completion → confirmed fixed → closed
 */
import type { JobRoute, JobStatus } from "@prisma/client";
import { conflict } from "@/lib/errors";

export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  NEW: ["ASSESSING", "APPROVED", "CANCELLED"],
  ASSESSING: ["ASSESSED", "CANCELLED"],
  ASSESSED: ["QUOTING", "APPROVED", "CANCELLED"],
  QUOTING: ["AWAITING_APPROVAL", "APPROVED", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "QUOTING", "CANCELLED"],
  APPROVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD", "AWAITING_VERIFICATION", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_VERIFICATION", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  AWAITING_VERIFICATION: ["VERIFIED", "CLOSED", "IN_PROGRESS"], // CLOSED directly only when reporter confirmation is off (closeJob)
  VERIFIED: ["CLOSED"],
  CLOSED: ["ASSIGNED"], // reopen
  CANCELLED: [],
};

export const canTransition = (from: JobStatus, to: JobStatus) => TRANSITIONS[from].includes(to);

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to))
    throw conflict(`This job is "${STATUS_LABEL[from]}" and cannot move to "${STATUS_LABEL[to]}".`);
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  NEW: "New report",
  ASSESSING: "Awaiting assessment",
  ASSESSED: "Assessed – decide how to fix",
  QUOTING: "Getting quotes",
  AWAITING_APPROVAL: "Awaiting spend approval",
  APPROVED: "Approved – awaiting assignment",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  AWAITING_VERIFICATION: "Awaiting confirmation",
  VERIFIED: "Confirmed fixed – ready to close",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const ROUTE_LABEL: Record<JobRoute, string> = { UNDECIDED: "Not decided yet", IN_HOUSE: "In-house team", CONTRACTOR: "External contractor" };

export const OPEN_STATUSES: JobStatus[] = [
  "NEW", "ASSESSING", "ASSESSED", "QUOTING", "AWAITING_APPROVAL", "APPROVED",
  "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "AWAITING_VERIFICATION", "VERIFIED",
];
export const REQUEST_STATUSES: JobStatus[] = ["NEW", "ASSESSING", "ASSESSED"];

export type Party = "Maintenance manager" | "Technician" | "Contractor" | "Approver" | "Reporter" | "Nobody";

/** What happens next and who must do it — shown on every job. */
export function nextAction(job: {
  status: JobStatus; route?: JobRoute; reporterConfirmation: boolean; leadTechnicianId?: string | null; contractorId?: string | null;
}): { label: string; party: Party } {
  const contractor = job.route === "CONTRACTOR";
  switch (job.status) {
    case "NEW": return { label: "Review the report and send it for assessment", party: "Maintenance manager" };
    case "ASSESSING": return { label: "Assess the problem", party: job.leadTechnicianId ? "Technician" : "Maintenance manager" };
    case "ASSESSED": return { label: "Decide: fix in-house or get contractor quotes", party: "Maintenance manager" };
    case "QUOTING": return { label: "Collect and compare quotes, then choose one", party: "Maintenance manager" };
    case "AWAITING_APPROVAL": return { label: "Approve or reject the recommended quote", party: "Approver" };
    case "APPROVED": return { label: "Assign a technician", party: "Maintenance manager" };
    case "ASSIGNED": return contractor ? { label: "Do the work and submit completion", party: "Contractor" } : { label: "Start the work", party: "Technician" };
    case "IN_PROGRESS": return contractor ? { label: "Finish the work and submit completion", party: "Contractor" } : { label: "Complete the work and submit evidence", party: "Technician" };
    case "ON_HOLD": return { label: "Resolve the hold and resume", party: "Maintenance manager" };
    case "AWAITING_VERIFICATION":
      return job.reporterConfirmation ? { label: "Confirm the fault is fixed", party: "Reporter" } : { label: "Check the work and confirm it is fixed", party: "Maintenance manager" };
    case "VERIFIED": return { label: "Close the job", party: "Maintenance manager" };
    default: return { label: "No further action", party: "Nobody" };
  }
}
