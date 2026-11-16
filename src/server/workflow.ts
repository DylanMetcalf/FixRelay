/**
 * The job lifecycle as an explicit state machine. This file is the single source of truth
 * for which status changes are legal. Services never set a status without going through
 * `assertTransition` + a guarded UPDATE (see services/jobs.ts `move`). Documented in WORKFLOWS.md.
 */
import type { JobStatus } from "@prisma/client";
import { conflict } from "@/lib/errors";

export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  NEW: ["ASSESSING", "APPROVED", "CANCELLED"],
  ASSESSING: ["ASSESSED", "CANCELLED"],
  ASSESSED: ["QUOTING", "APPROVED", "CANCELLED"],
  QUOTING: ["AWAITING_APPROVAL", "APPROVED", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "QUOTING", "CANCELLED"],
  APPROVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_VERIFICATION", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  AWAITING_VERIFICATION: ["VERIFIED", "CLOSED", "IN_PROGRESS"],
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
  NEW: "New request",
  ASSESSING: "Awaiting assessment",
  ASSESSED: "Assessed",
  QUOTING: "Quote being prepared",
  AWAITING_APPROVAL: "Quote awaiting approval",
  APPROVED: "Approved – awaiting assignment",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  AWAITING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified – ready to close",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const OPEN_STATUSES: JobStatus[] = [
  "NEW", "ASSESSING", "ASSESSED", "QUOTING", "AWAITING_APPROVAL", "APPROVED",
  "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "AWAITING_VERIFICATION", "VERIFIED",
];
export const REQUEST_STATUSES: JobStatus[] = ["NEW", "ASSESSING", "ASSESSED"];

export type Party = "Manager" | "Technician" | "Customer" | "Nobody";

/** What happens next and who must do it — shown on every job. */
export function nextAction(job: {
  status: JobStatus;
  customerSignoffRequired: boolean;
  leadTechnicianId?: string | null;
}): { label: string; party: Party } {
  switch (job.status) {
    case "NEW":
      return { label: "Review and send for assessment", party: "Manager" };
    case "ASSESSING":
      return { label: "Assess the problem", party: job.leadTechnicianId ? "Technician" : "Manager" };
    case "ASSESSED":
      return { label: "Prepare a quote or authorise the work", party: "Manager" };
    case "QUOTING":
      return { label: "Finish and submit the quote", party: "Manager" };
    case "AWAITING_APPROVAL":
      return { label: "Approve or reject the quote", party: "Customer" };
    case "APPROVED":
      return { label: "Assign a technician", party: "Manager" };
    case "ASSIGNED":
      return { label: "Start the work", party: "Technician" };
    case "IN_PROGRESS":
      return { label: "Complete the work and submit evidence", party: "Technician" };
    case "ON_HOLD":
      return { label: "Resolve the hold and resume", party: "Manager" };
    case "AWAITING_VERIFICATION":
      return job.customerSignoffRequired
        ? { label: "Verify and sign off the completed work", party: "Customer" }
        : { label: "Verify the work and close the job", party: "Manager" };
    case "VERIFIED":
      return { label: "Close the job", party: "Manager" };
    default:
      return { label: "No further action", party: "Nobody" };
  }
}
