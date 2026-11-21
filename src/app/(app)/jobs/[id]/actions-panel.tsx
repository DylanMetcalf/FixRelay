import * as a from "@/app/actions/jobs";
import { RootCauseFields, SignLine } from "@/components/requisition-fields";
import { Step, Stepper } from "@/components/stepper";
import { LinkForm } from "@/components/client-forms";
import { ActionButton, Form, Submit } from "@/components/form";
import { Card, Check, Field, Select, TextArea } from "@/components/ui";
import { can, type Ctx } from "@/server/permissions";
import type { JobView } from "@/server/services/jobs";
import { PRIORITY_HELP, PRIORITY_LABEL, PRIORITY_ORDER } from "@/server/workflow";

type Opt = { value: string; label: string };
const FILES = "image/*,application/pdf";

/** Everything the signed-in person can do to this job right now. Buttons mirror server permissions; the server re-checks. */
export function ActionsPanel({ job, ctx, team, contractors, suggestedScope, sigRequired }: { job: JobView; ctx: Ctx; team: Opt[]; contractors: Opt[]; suggestedScope: string; sigRequired: boolean }) {
  const h = { jobId: job.id };
  const manage = can(ctx, "job.manage");
  const contractorJob = job.route === "CONTRACTOR";
  const worker = can(ctx, "job.work") && (manage || job.assigned) && !contractorJob;
  const reporter = !!job.requesterId && job.requesterId === ctx.userId;
  const st = job.status;
  const open = st !== "CLOSED" && st !== "CANCELLED";
  const blocks: React.ReactNode[] = [];
  const D = ({ label, children, primary }: { label: string; children: React.ReactNode; primary?: boolean }) => (
    <details className="action" open={primary}><summary>{label}</summary>{children}</details>
  );

  const foodArea = !!job.location?.foodArea;
  const received = <SignLine label="Submitted to – received by maintenance (your signature)" required={sigRequired} />;
  const assessmentForm = (fromNew: boolean) => (
    <Form action={a.assessmentAction} hidden={h}>
      <TextArea label="What did you find?" name="findings" required />
      <TextArea label="Likely cause" name="suspectedCause" rows={2} />
      <TextArea label="Work needed to fix it" name="recommendedWork" rows={2} />
      <TextArea label="Parts / materials" name="materials" rows={2} />
      <Select label="Spares or parts needed?" name="sparesNeeded" required options={[{ value: "NOT_NEEDED", label: "No spares needed" }, { value: "ON_HAND", label: "Yes – in stock (stores to issue)" }, { value: "TO_BUY", label: "Yes – must be bought or quoted (stores to order)" }]} hint="Stores and the maintenance manager are told straight away." />
      <TextArea label="Which spares? (if needed)" name="sparesList" rows={2} placeholder="e.g. 2 × 6204 bearings, 1 m drive belt" />
      <Field label="Time needed (hours)" name="labourHoursEstimate" inputMode="decimal" />
      <Select label="Who should fix it?" name="quoteRequired" required options={[{ value: "no", label: "Our in-house team can fix it" }, { value: "yes", label: "Needs an external contractor (get quotes)" }]} />
      <Check name="externalHelpRequired" label="A specialist is needed" />
      <Field label="Photos" name="files"><input id="files" name="files" type="file" multiple accept={FILES} capture="environment" className="input" /></Field>
      {fromNew && received}
      <Submit>Submit assessment</Submit>
    </Form>
  );
  const inHouse = (primary = false) => (
    <D key="inhouse" label="Fix it in-house" primary={primary}>
      <Form action={a.inHouseAction} hidden={h}>
        <TextArea label="Note (optional)" name="note" rows={2} placeholder="e.g. parts in stock, quick fix" />
        <Submit>Give to the in-house team</Submit>
      </Form>
    </D>
  );
  const captureQuote = () => (
      <D key="capture" label="Capture a quote received by email">
        <Form action={a.recordQuoteAction} hidden={h}>
          <Select label="Contractor" name="contractorId" required options={[{ value: "", label: "Choose…" }, ...contractors]} />
          <TextArea label="What the quote covers" name="scope" required rows={2} />
          <Field label="Price excl. VAT (R) – VAT is added if the contractor is VAT registered" name="price" required inputMode="decimal" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Can start within (days)" name="leadTimeDays" inputMode="numeric" />
            <Field label="Valid until" name="validUntil" type="date" />
          </div>
          <Field label="Quote document" name="files"><input id="q-files" name="files" type="file" multiple accept={FILES} className="input" /></Field>
          <Submit>Save quote</Submit>
        </Form>
      </D>
  );
  const requestQuotes = (label: string, primary = false) => (
    <D key="rfq" label={label} primary={primary}>
      {contractors.length === 0 ? <p className="text-sm">Add contractors to your <a className="link" href="/contractors">contractor directory</a> first.</p> : (
        <LinkForm action={a.requestQuotesAction} hidden={h} submit="Send quote requests" shareLabel="Quote requests sent (first link shown)">
          <fieldset><legend className="label">Which contractors?</legend>
            <div className="grid gap-1 sm:grid-cols-2">{contractors.map((c) => <label key={c.value} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="contractorIds" value={c.value} className="h-4 w-4" />{c.label}</label>)}</div>
          </fieldset>
          <TextArea label="Work to quote for" name="scope" required rows={3} defaultValue={suggestedScope} />
          <Field label="Quotes needed by" name="deadline" type="date" />
          <p className="text-xs text-gray-600">Each contractor gets a secure link by email to see the fault, photos and location, and to submit a quote. No account needed.</p>
        </LinkForm>
      )}
    </D>
  );

  if (manage && st === "NEW") {
    blocks.push(
      <D key="req" label={job.source === "PUBLIC_LINK" ? "Accept and send for assessment" : "Send for assessment"} primary>
        <Form action={a.requestAssessmentAction} hidden={h}>
          <Select label="Who should assess it?" name="assessorId" options={[{ value: "", label: "No one yet (unassigned queue)" }, ...team]} />
          {received}
          <Submit>Send for assessment</Submit>
        </Form>
      </D>,
      <D key="assess" label="Assess it myself now">{assessmentForm(true)}</D>,
    );
    if (job.emergency) blocks.push(inHouse(), requestQuotes("Emergency: get quotes now"));
  }
  if (st === "ASSESSING" && can(ctx, "job.assess") && (manage || job.assigned)) blocks.push(<D key="assess" label="Record assessment" primary>{assessmentForm(false)}</D>);
  if (manage && st === "ASSESSED") blocks.push(inHouse(true), requestQuotes("Get contractor quotes", true), captureQuote());
  if (manage && st === "QUOTING") {
    blocks.push(requestQuotes("Ask more contractors"));
    blocks.push(captureQuote(), inHouse());
  }
  if (manage && st === "APPROVED" && !contractorJob) {
    blocks.push(
      <D key="assign" label="Assign a technician" primary>
        <Form action={a.assignAction} hidden={h}>
          <Select label="Responsible technician" name="leadTechnicianId" required defaultValue={job.leadTechnicianId ?? ""} options={[{ value: "", label: "Choose…" }, ...team]} />
          <fieldset><legend className="label">Others helping</legend>
            <div className="grid grid-cols-2 gap-1">{team.map((t) => <label key={t.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="additionalIds" value={t.value} defaultChecked={job.technicians.some((x) => x.userId === t.value)} className="h-4 w-4" />{t.label}</label>)}</div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planned start" name="plannedStart" type="date" defaultValue={job.plannedStart?.toISOString().slice(0, 10)} />
            <Field label="Planned finish" name="plannedEnd" type="date" defaultValue={job.plannedEnd?.toISOString().slice(0, 10)} />
          </div>
          <TextArea label="Instructions" name="instructions" rows={2} defaultValue={job.instructions ?? ""} />
          <Submit>Assign job</Submit>
        </Form>
      </D>,
    );
  }
  if (worker && st === "ASSIGNED") blocks.push(<ActionButton key="start" action={a.startAction} hidden={h}>Start work</ActionButton>);
  if (worker && (st === "IN_PROGRESS" || st === "ASSIGNED" || st === "ON_HOLD")) {
    blocks.push(
      <D key="upd" label="Add update / note">
        <Form action={a.workUpdateAction} hidden={h}>
          <Select label="Type" name="kind" options={[{ value: "PROGRESS", label: "Progress update" }, { value: "NOTE", label: "Note" }, { value: "CLARIFICATION", label: "I need more information" }, { value: "ADDITIONAL_WORK", label: "More work is needed than planned" }]} />
          <TextArea label="Update" name="note" required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Time spent (minutes)" name="labourMinutes" inputMode="numeric" />
            <Field label="Material cost (R)" name="materialCost" inputMode="decimal" />
          </div>
          <Field label="Materials used" name="materialDescription" />
          <Field label="Photos" name="files"><input id="upd-files" name="files" type="file" multiple accept={FILES} capture="environment" className="input" /></Field>
          <Submit>Add update</Submit>
        </Form>
      </D>,
    );
  }
  if (manage && contractorJob && ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(st)) {
    blocks.push(
      <D key="note" label="Add a note">
        <Form action={a.workUpdateAction} hidden={{ ...h, kind: "NOTE" }}>
          <TextArea label="Note (e.g. contractor on site, parts ordered)" name="note" required />
          <Submit>Add note</Submit>
        </Form>
      </D>,
    );
  }
  if (worker && st === "IN_PROGRESS") {
    blocks.push(
      <D key="done" label="Work finished – submit evidence" primary>
        <Form action={a.completionAction} hidden={h}>
          <Stepper>
            <Step title="Maintenance report">
              <TextArea label="What was done?" name="workPerformed" required />
              <TextArea label="Anything to watch?" name="observations" rows={2} />
            </Step>
            <Step title="Photos and documents">
              <Field label="Before photos" name="before"><input id="before" name="before" type="file" multiple accept="image/*" className="input" /></Field>
              <Field label="After photos" name="after" hint="At least one after-photo or test document is required."><input id="after" name="after" type="file" multiple accept="image/*" capture="environment" className="input" /></Field>
              <Field label="Test documents" name="tests"><input id="tests" name="tests" type="file" multiple accept={FILES} className="input" /></Field>
            </Step>
            <Step title="Root cause"><RootCauseFields foodArea={foodArea} /></Step>
            <Step title="Check and sign" review>
              <SignLine label="Work completed by – your signature" required={sigRequired} />
              <Submit>Submit for confirmation</Submit>
            </Step>
          </Stepper>
        </Form>
      </D>,
    );
  }
  if (manage && contractorJob && (st === "ASSIGNED" || st === "IN_PROGRESS")) {
    blocks.push(
      <D key="resend" label="Resend the contractor's completion link">
        <LinkForm action={a.resendCompletionLinkAction} hidden={h} submit="Email a new link" shareLabel="New completion link"><p className="text-sm text-gray-700">The old link stops working.</p></LinkForm>
      </D>,
      <D key="record" label="Record completion for the contractor">
        <Form action={a.completionAction} hidden={h}>
          <p className="text-sm text-gray-700">Use this if the contractor sent their report and photos by email.</p>
          <TextArea label="What the contractor did" name="workPerformed" required />
          <Field label="After photos / job card" name="after" hint="At least one after-photo or test document is required."><input id="c-after" name="after" type="file" multiple accept="image/*" className="input" /></Field>
          <Field label="Documents" name="tests"><input id="c-tests" name="tests" type="file" multiple accept={FILES} className="input" /></Field>
          <RootCauseFields foodArea={foodArea} />
          <SignLine label="Your signature (recording for the contractor)" required={sigRequired} />
          <Submit>Submit for confirmation</Submit>
        </Form>
      </D>,
    );
  }
  if (worker && (st === "ASSIGNED" || st === "IN_PROGRESS")) blocks.push(
    <D key="hold" label="Put on hold"><Form action={a.holdAction} hidden={h}><TextArea label="Reason" name="reason" required rows={2} placeholder="e.g. Waiting for parts" /><Submit>Put on hold</Submit></Form></D>,
  );
  if (worker && st === "ON_HOLD") blocks.push(<ActionButton key="res" action={a.resumeAction} hidden={h}>Resume work</ActionButton>);

  if (st === "AWAITING_VERIFICATION") {
    if (reporter) blocks.push(
      <D key="confirm" label="Is it fixed?" primary>
        <Form action={a.confirmFixedAction} hidden={h}>
          <Select label="Your answer" name="outcome" required options={[{ value: "APPROVED", label: "Yes – it is fixed" }, { value: "REJECTED", label: "No – it is still not right" }]} />
          <TextArea label="Comments" name="comment" rows={2} hint="If it is not fixed, say what is still wrong." />
          <p className="text-sm font-semibold">I hereby confirm that the above reported problem has been resolved (or not, as answered above).</p>
          <SignLine label="Confirmed by originator – your signature" required={sigRequired} />
          <Submit>Send my answer</Submit>
        </Form>
      </D>,
    );
    if (manage && !reporter) blocks.push(
      <D key="mgr" label={job.reporterConfirmation ? "Confirm fixed yourself" : "Check and confirm fixed"} primary={!job.reporterConfirmation}>
        <Form action={a.confirmFixedAction} hidden={h}>
          <Select label="Result" name="outcome" required options={[{ value: "APPROVED", label: "Fixed" }, { value: "REJECTED", label: "Not fixed – send back" }]} />
          <TextArea label={job.reporterConfirmation ? "Why are you confirming instead of the reporter?" : "Comment"} name="comment" rows={2} required={job.reporterConfirmation} placeholder={job.reporterConfirmation ? "e.g. checked on site; reporter is on leave" : ""} />
          <Submit>Record result</Submit>
        </Form>
      </D>,
    );
    if (can(ctx, "job.work") && (manage || job.assigned)) blocks.push(
      <D key="sign" label="Get the reporter's signature on this device">
        <Form action={a.captureSignoffAction} hidden={h}>
          <p className="text-sm text-gray-700">Hand the device to the person who reported the fault (or the area supervisor).</p>
          <Field label="Their full name" name="name" required autoComplete="off" defaultValue={job.requesterId ? "" : (job.reporterName ?? "")} />
          <Select label="Is it fixed?" name="outcome" required options={[{ value: "APPROVED", label: "Yes – it is fixed" }, { value: "REJECTED", label: "No – it is still not right" }]} />
          <TextArea label="Comments" name="comment" rows={2} hint="Required if not fixed." />
          <SignLine label="Confirmed by originator – their signature" required />
          <Submit>Record sign-off</Submit>
        </Form>
      </D>,
    );
    if (manage && !job.reporterConfirmation) blocks.push(
      <D key="close-direct" label="Confirm fixed, sign off and close">
        <Form action={a.closeAction} hidden={h}>
          <TextArea label="Comment (optional)" name="comment" rows={2} placeholder="e.g. checked on site" />
          <SignLine label="Confirmed by manager – your signature" required={sigRequired} />
          <Submit>Sign off and close</Submit>
        </Form>
      </D>,
    );
  }
  if (manage && st === "VERIFIED") blocks.push(
    <D key="close" label="Sign off and close" primary>
      <Form action={a.closeAction} hidden={h}>
        <p className="text-sm text-gray-700">The fault has been confirmed fixed. Your sign-off closes the requisition and files it in the history.</p>
        <SignLine label="Confirmed by manager – your signature" required={sigRequired} />
        <Submit>Sign off and close</Submit>
      </Form>
    </D>,
  );
  if (st === "CLOSED" && can(ctx, "job.create")) blocks.push(
    <a key="repeat" href={`/requests/new?repeatOf=${job.id}`} className="btn btn-secondary" data-testid="report-repeat">The fault came back – report a repeat</a>,
  );
  if (manage && st === "CLOSED") blocks.push(
    <D key="reopen" label="Reopen job"><Form action={a.reopenAction} hidden={h}><TextArea label="Why is it being reopened?" name="reason" required rows={2} /><Submit>Reopen job</Submit></Form></D>,
  );
  if (open && (manage || reporter) && can(ctx, "job.create")) blocks.push(
    <D key="photo" label="Add photos to the report">
      <Form action={a.evidenceAction} hidden={{ ...h, kind: "REQUEST" }}>
        <Field label="Photos or documents" name="files"><input id="req-files" name="files" type="file" multiple accept={FILES} className="input" /></Field>
        <Submit>Upload</Submit>
      </Form>
    </D>,
  );
  if (manage && open) {
    blocks.push(
      <D key="prio" label="Change urgency">
        <Form action={a.priorityAction} hidden={h}>
          <Select label="Urgency" name="priority" defaultValue={job.priority} options={PRIORITY_ORDER.map((p) => ({ value: p, label: `${PRIORITY_LABEL[p]} – ${PRIORITY_HELP[p].toLowerCase()}` }))} />
          <Submit>Save</Submit>
        </Form>
      </D>,
    );
    if (!["AWAITING_VERIFICATION", "VERIFIED"].includes(st) && job.requesterId) blocks.push(
      <ActionButton key="so" action={a.signoffRuleAction} hidden={{ ...h, required: String(!job.reporterConfirmation) }} className="btn btn-secondary">
        {job.reporterConfirmation ? "Don't ask the reporter to confirm" : "Ask the reporter to confirm"}
      </ActionButton>,
    );
    if (st !== "VERIFIED" && st !== "AWAITING_VERIFICATION") blocks.push(
      <D key="cancel" label={job.source === "PUBLIC_LINK" && st === "NEW" ? "Reject this report" : "Cancel job"}>
        <Form action={a.cancelAction} hidden={h}><TextArea label="Reason" name="reason" required rows={2} placeholder={st === "NEW" ? "e.g. duplicate of REQ-00012, not a maintenance issue" : ""} /><Submit className="btn btn-danger" confirm="Cancel this job? This cannot be undone.">Cancel job</Submit></Form>
      </D>,
    );
  }
  if (blocks.length === 0) return null;
  return <Card title="Actions" className="no-print"><div className="flex flex-wrap items-start gap-2" data-testid="actions">{blocks}</div></Card>;
}
