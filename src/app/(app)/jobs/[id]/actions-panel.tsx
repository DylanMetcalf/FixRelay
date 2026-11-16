import Link from "next/link";
import * as a from "@/app/actions/jobs";
import { SignaturePad } from "@/components/client";
import { LinkForm } from "@/components/client-forms";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, Check, Field, Select, TextArea } from "@/components/ui";
import { can, type Ctx } from "@/server/permissions";
import type { JobView } from "@/server/services/jobs";

type Opt = { value: string; label: string };
const FILES = "image/*,application/pdf";

/** Everything the signed-in person can do to this job right now. Buttons mirror server permissions; the server re-checks. */
export function ActionsPanel({ job, ctx, team }: { job: JobView; ctx: Ctx; team: Opt[] }) {
  const h = { jobId: job.id };
  const manage = can(ctx, "job.manage");
  const worker = can(ctx, "job.work") && (manage || job.assigned);
  const customer = can(ctx, "customer.decide");
  const st = job.status;
  const open = st !== "CLOSED" && st !== "CANCELLED";
  const completion = job.completions.find((c) => c.status === "SUBMITTED");
  const draft = job.quotes.find((q) => q.status === "DRAFT");
  const pendingQuote = job.quotes.find((q) => q.status === "SUBMITTED");
  const blocks: React.ReactNode[] = [];
  const D = ({ label, children, primary }: { label: string; children: React.ReactNode; primary?: boolean }) => (
    <details className="action" open={primary}><summary>{label}</summary>{children}</details>
  );

  const assessmentForm = (
    <Form action={a.assessmentAction} hidden={h}>
      <TextArea label="Findings" name="findings" required placeholder="What did you find?" />
      <TextArea label="Suspected cause" name="suspectedCause" rows={2} />
      <TextArea label="Recommended work" name="recommendedWork" rows={2} />
      <TextArea label="Materials required" name="materials" rows={2} />
      <Field label="Labour estimate (hours)" name="labourHoursEstimate" inputMode="decimal" />
      <Select label="Is a quotation required?" name="quoteRequired" required options={[{ value: "yes", label: "Yes – the customer must approve a quote" }, { value: "no", label: "No – can be authorised without a quote" }]} />
      <Check name="externalHelpRequired" label="Specialised external assistance is required" />
      <Field label="Photos" name="files"><input id="files" name="files" type="file" multiple accept={FILES} capture="environment" className="input" /></Field>
      <Submit>Submit assessment</Submit>
    </Form>
  );
  const authorise = (
    <D key="auth" label="Authorise without a quote">
      <Form action={a.authoriseAction} hidden={h}>
        <TextArea label="Why is no customer-approved quotation needed?" name="reason" required rows={2} placeholder="e.g. Covered by service contract; emergency call-out agreed by phone" hint="This reason is permanently recorded in the job history." />
        <Submit>Authorise work</Submit>
      </Form>
    </D>
  );
  const assignForm = (label: string, primary?: boolean) => (
    <D key="assign" label={label} primary={primary}>
      <Form action={a.assignAction} hidden={h}>
        <Select label="Responsible technician" name="leadTechnicianId" required defaultValue={job.leadTechnicianId ?? ""} options={[{ value: "", label: "Choose…" }, ...team]} />
        <fieldset><legend className="label">Additional technicians</legend>
          <div className="grid grid-cols-2 gap-1">{team.map((t) => <label key={t.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="additionalIds" value={t.value} defaultChecked={job.technicians.some((x) => x.userId === t.value)} className="h-4 w-4" />{t.label}</label>)}</div>
        </fieldset>
        <Field label="External contractor (if any)" name="externalContractor" defaultValue={job.externalContractor ?? ""} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Planned start" name="plannedStart" type="date" defaultValue={job.plannedStart?.toISOString().slice(0, 10)} />
          <Field label="Planned completion" name="plannedEnd" type="date" defaultValue={job.plannedEnd?.toISOString().slice(0, 10)} />
        </div>
        <TextArea label="Job instructions" name="instructions" rows={2} defaultValue={job.instructions ?? ""} />
        <Submit>{st === "APPROVED" ? "Assign job" : "Save assignment"}</Submit>
      </Form>
    </D>
  );

  if (manage && st === "NEW") {
    blocks.push(
      <D key="req" label="Send for assessment" primary>
        <Form action={a.requestAssessmentAction} hidden={h}>
          <Select label="Who should assess it?" name="assessorId" options={[{ value: "", label: "No one yet (unassigned queue)" }, ...team]} />
          <Submit>Send for assessment</Submit>
        </Form>
      </D>,
      <D key="assess" label="Assess it myself now">{assessmentForm}</D>,
    );
    if (job.emergency) blocks.push(authorise);
  }
  if (st === "ASSESSING" && can(ctx, "job.assess") && (manage || job.assigned)) blocks.push(<D key="assess" label="Record assessment" primary>{assessmentForm}</D>);
  if (manage && st === "ASSESSED") blocks.push(<ActionButton key="quote" action={a.createQuoteAction} hidden={{ ...h, kind: "ORIGINAL" }}>Prepare quotation</ActionButton>, authorise);
  if (manage && st === "QUOTING") {
    if (draft) blocks.push(<Link key="draft" href={`/quotes/${draft.id}`} className="btn btn-primary">Continue quote {draft.number} v{draft.version}</Link>);
    else { const rej = job.quotes.find((q) => q.status === "REJECTED"); if (rej) blocks.push(<Link key="rev" href={`/quotes/${rej.id}`} className="btn btn-primary">Revise rejected quote {rej.number}</Link>); }
    blocks.push(authorise);
  }
  if (pendingQuote && (manage || customer)) blocks.push(<Link key="pq" href={`/quotes/${pendingQuote.id}`} className="btn btn-primary">{customer ? "Review and decide on quotation" : `Open quote ${pendingQuote.number} (send link / record decision)`}</Link>);
  if (manage && st === "APPROVED") blocks.push(assignForm("Assign a technician", true));
  if (worker && st === "ASSIGNED") blocks.push(<ActionButton key="start" action={a.startAction} hidden={h}>Start work</ActionButton>);
  if (worker && (st === "IN_PROGRESS" || st === "ASSIGNED" || st === "ON_HOLD")) {
    blocks.push(
      <D key="upd" label="Add update / note">
        <Form action={a.workUpdateAction} hidden={h} resetOnOk>
          <Select label="Type" name="kind" options={[{ value: "PROGRESS", label: "Progress update" }, { value: "NOTE", label: "Work note" }, { value: "CLARIFICATION", label: "I need clarification" }, { value: "ADDITIONAL_WORK", label: "Additional work is needed (needs approval)" }]} />
          <TextArea label="Update" name="note" required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Labour (minutes)" name="labourMinutes" inputMode="numeric" />
            <Field label="Material cost (R)" name="materialCost" inputMode="decimal" />
          </div>
          <Field label="Materials used" name="materialDescription" />
          <Field label="Photos" name="files"><input id="upd-files" name="files" type="file" multiple accept={FILES} capture="environment" className="input" /></Field>
          <Submit>Add update</Submit>
        </Form>
      </D>,
    );
  }
  if (worker && st === "IN_PROGRESS") {
    blocks.push(
      <D key="done" label="Complete work and submit evidence" primary>
        <Form action={a.completionAction} hidden={h}>
          <TextArea label="Work performed" name="workPerformed" required placeholder="What was done to fix the problem?" />
          <TextArea label="Outstanding observations" name="observations" rows={2} placeholder="Anything the customer should know or watch" />
          <Field label="Before photos" name="before"><input id="before" name="before" type="file" multiple accept="image/*" className="input" /></Field>
          <Field label="After photos" name="after" hint="At least one after-photo or test document is required."><input id="after" name="after" type="file" multiple accept="image/*" className="input" /></Field>
          <Field label="Test documents" name="tests"><input id="tests" name="tests" type="file" multiple accept={FILES} className="input" /></Field>
          <Submit>Submit for verification</Submit>
        </Form>
      </D>,
    );
    if (manage) blocks.push(<ActionButton key="var" action={a.createQuoteAction} hidden={{ ...h, kind: "VARIATION" }} className="btn btn-secondary">Quote additional work (variation)</ActionButton>);
  }
  if (worker && (st === "ASSIGNED" || st === "IN_PROGRESS")) blocks.push(
    <D key="hold" label="Put on hold"><Form action={a.holdAction} hidden={h}><TextArea label="Reason" name="reason" required rows={2} placeholder="e.g. Waiting for parts" /><Submit>Put on hold</Submit></Form></D>,
  );
  if (worker && st === "ON_HOLD") blocks.push(<ActionButton key="res" action={a.resumeAction} hidden={h}>Resume work</ActionButton>);
  if (manage && (st === "ASSIGNED" || st === "IN_PROGRESS" || st === "ON_HOLD")) blocks.push(assignForm("Change assignment / dates"));

  if (completion && st === "AWAITING_VERIFICATION") {
    if (customer) blocks.push(
      <D key="cdec" label="Verify completed work" primary>
        <Form action={a.portalCompletionAction} hidden={{ completionId: completion.id }}>
          <Select label="Your decision" name="outcome" required options={[{ value: "APPROVED", label: "Approve – the work is complete" }, { value: "REJECTED", label: "Reject – the work is not acceptable" }]} />
          <TextArea label="Comments" name="comment" rows={2} hint="Required if you reject." />
          <SignaturePad />
          <Submit>Record my decision</Submit>
        </Form>
      </D>,
    );
    if (job.customerSignoffRequired && can(ctx, "signoff.capture") && (manage || job.assigned)) blocks.push(
      <D key="inperson" label="Capture customer sign-off on this device" primary={!manage}>
        <Form action={a.captureSignoffAction} hidden={{ completionId: completion.id }}>
          <p className="text-sm text-gray-700">Hand the device to the customer's authorised representative.</p>
          <Field label="Customer's full name" name="name" required autoComplete="off" />
          <Select label="Decision" name="outcome" required options={[{ value: "APPROVED", label: "Approve – the work is complete" }, { value: "REJECTED", label: "Reject – the work is not acceptable" }]} />
          <TextArea label="Comments" name="comment" rows={2} hint="Required if rejecting." />
          <SignaturePad />
          <Submit>Record sign-off</Submit>
        </Form>
      </D>,
    );
    if (manage && job.customerSignoffRequired) blocks.push(
      <D key="vlink" label="Send verification link to customer" primary>
        <LinkForm action={a.sendLinkAction} hidden={{ completionId: completion.id }} submit="Create secure link" shareLabel="Verification link created">
          <Field label="Recipient name" name="recipientName" required defaultValue={job.client.contactName} />
          <Field label="Recipient email" name="recipientEmail" type="email" required defaultValue={job.client.email} />
        </LinkForm>
      </D>,
    );
    if (manage && !job.customerSignoffRequired) blocks.push(
      <D key="close" label="Verify and close job" primary><Form action={a.closeAction} hidden={h}><TextArea label="Verification comment (optional)" name="comment" rows={2} /><Submit>Verify and close</Submit></Form></D>,
    );
  }
  if (manage && st === "VERIFIED") blocks.push(<ActionButton key="close" action={a.closeAction} hidden={h}>Close job</ActionButton>);
  if (manage && st === "CLOSED") blocks.push(
    <D key="reopen" label="Reopen job"><Form action={a.reopenAction} hidden={h}><TextArea label="Why is it being reopened?" name="reason" required rows={2} /><Submit>Reopen job</Submit></Form></D>,
  );
  if (open && (manage || job.requesterId === ctx.userId) && can(ctx, "job.create")) blocks.push(
    <D key="photo" label="Add photos to the request">
      <Form action={a.evidenceAction} hidden={{ ...h, kind: "REQUEST" }} resetOnOk>
        <Field label="Photos or documents" name="files"><input id="req-files" name="files" type="file" multiple accept={FILES} className="input" /></Field>
        <Submit>Upload</Submit>
      </Form>
    </D>,
  );
  if (manage && open) {
    blocks.push(
      <D key="prio" label="Change priority">
        <Form action={a.priorityAction} hidden={h}>
          <Select label="Priority" name="priority" defaultValue={job.priority} options={["LOW", "NORMAL", "HIGH", "CRITICAL"].map((p) => ({ value: p, label: p[0] + p.slice(1).toLowerCase() }))} />
          <Submit>Save priority</Submit>
        </Form>
      </D>,
    );
    if (!["AWAITING_VERIFICATION", "VERIFIED"].includes(st)) blocks.push(
      <ActionButton key="so" action={a.signoffRuleAction} hidden={{ ...h, required: String(!job.customerSignoffRequired) }} className="btn btn-secondary"
        confirm={job.customerSignoffRequired ? "Allow this job to be closed without customer sign-off? This is recorded in the history." : undefined}>
        {job.customerSignoffRequired ? "Waive customer sign-off" : "Require customer sign-off"}
      </ActionButton>,
    );
    if (st !== "VERIFIED" && st !== "AWAITING_VERIFICATION") blocks.push(
      <D key="cancel" label="Cancel job"><Form action={a.cancelAction} hidden={h}><TextArea label="Reason for cancelling" name="reason" required rows={2} /><Submit className="btn btn-danger" confirm="Cancel this job? This cannot be undone.">Cancel job</Submit></Form></D>,
    );
  }
  if (blocks.length === 0) return null;
  return <Card title="Actions" className="no-print"><div className="flex flex-wrap items-start gap-2" data-testid="actions">{blocks}</div></Card>;
}
