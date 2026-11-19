import * as a from "@/app/actions/jobs";
import { Form, Submit } from "@/components/form";
import { Card, Field, Pill, Select, TextArea, fmtDate } from "@/components/ui";
import { can, type Ctx } from "@/server/permissions";
import type { JobView } from "@/server/services/jobs";
import { SPARES_LABEL } from "@/server/workflow";

const ASK_STATUSES = ["ASSESSED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];

/** Spares for this job: what is needed, where it stands, and the next step for stores (issue, order, receive). */
export function SparesCard({ job, ctx }: { job: JobView; ctx: Ctx }) {
  const s = job.sparesStatus;
  const open = job.status !== "CLOSED" && job.status !== "CANCELLED";
  const stores = can(ctx, "spares.manage") && open;
  const canAsk = open && can(ctx, "job.work") && (can(ctx, "job.manage") || job.assigned) && job.route !== "CONTRACTOR"
    && ASK_STATUSES.includes(job.status) && (s === "NOT_NEEDED" || s === "READY");
  if (s === "NOT_NEEDED" && !canAsk) return null;
  const h = { jobId: job.id };
  const tone = s === "READY" ? "green" : s === "NOT_NEEDED" ? "gray" : "amber";

  return (
    <Card title="Spares and parts" aside={<Pill tone={tone}>{SPARES_LABEL[s]}</Pill>}>
      <div data-testid="spares-card" className="space-y-3">
        {job.sparesList && <div><p className="label">Needed</p><p className="whitespace-pre-line text-sm">{job.sparesList}</p></div>}
        {job.sparesNote && <p className="text-sm"><span className="font-semibold">Stores note:</span> {job.sparesNote}</p>}
        {s === "ORDERED" && job.sparesEta && <p className="text-sm"><span className="font-semibold">Expected:</span> {fmtDate(job.sparesEta)}</p>}

        {stores && (s === "ON_HAND" || s === "TO_BUY" || s === "ORDERED") && (
          <details className="action" open>
            <summary>{s === "ORDERED" ? "Spares arrived" : "Issue the spares from stores"}</summary>
            <Form action={a.sparesAction} hidden={{ ...h, sparesAction: s === "ORDERED" ? "RECEIVED" : "ISSUED" }}>
              <Field label="Note (optional)" name="note" id={`spares-note-${s}`} placeholder={s === "ORDERED" ? "e.g. delivered, in the workshop" : "e.g. issued to the technician"} />
              <Submit>{s === "ORDERED" ? "Mark as received" : "Mark as issued"}</Submit>
            </Form>
          </details>
        )}
        {stores && s === "TO_BUY" && (
          <details className="action">
            <summary>Ordered from a supplier</summary>
            <Form action={a.sparesAction} hidden={{ ...h, sparesAction: "ORDERED" }}>
              <Field label="Supplier and order number" name="note" id="spares-order-note" required placeholder="e.g. Bearing Man, PO 4471" />
              <Field label="Expected delivery" name="eta" id="spares-eta" type="date" />
              <Submit>Mark as ordered</Submit>
            </Form>
          </details>
        )}
        {canAsk && (
          <details className="action" open={false}>
            <summary>{s === "READY" ? "Need more spares?" : "Ask stores for spares"}</summary>
            <Form action={a.requestSparesAction} hidden={h}>
              <Select label="Are they in stock?" name="sparesNeeded" id="spares-ask-stock" required options={[{ value: "ON_HAND", label: "In stock – stores to issue" }, { value: "TO_BUY", label: "Not in stock – must be bought or quoted" }]} />
              <TextArea label="Which spares or parts?" name="sparesList" id="spares-ask-list" required rows={2} placeholder="e.g. 2 × 6204 bearings, 1 m drive belt" />
              <Submit>Tell stores</Submit>
            </Form>
          </details>
        )}
      </div>
    </Card>
  );
}
