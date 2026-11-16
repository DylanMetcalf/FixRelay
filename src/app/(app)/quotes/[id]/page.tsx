import Link from "@/components/link";
import { notFound } from "next/navigation";
import * as a from "@/app/actions/jobs";
import { requirePage } from "@/app/_lib/session";
import { LinkForm, QuoteEditor } from "@/components/client-forms";
import { ActionButton, Form, Submit } from "@/components/form";
import { PrintButton } from "@/components/print";
import { QuoteDocument } from "@/components/quote-doc";
import { Card, Field, fmtDateTime, PageHeader, QuotePill, Select, TextArea } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { formatZar } from "@/lib/money";
import { can } from "@/server/permissions";
import { getQuote } from "@/server/services/quotes";

export const metadata = { title: "Quote" };
const DECISION = [{ value: "APPROVED", label: "Approve" }, { value: "REJECTED", label: "Reject" }];

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, org } = await requirePage("quote.view");
  const q = await getQuote(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const manage = can(ctx, "quote.manage");
  const customer = can(ctx, "customer.decide");
  const latest = q.versions[0]?.id === q.id;
  return (
    <>
      <PageHeader title={`Quote ${q.number} v${q.version}`} subtitle={<><Link className="link" href={`/jobs/${q.job.id}`}>{q.job.reference}</Link> · {q.job.title} · {q.job.client.name}</>}>
        {q.status !== "DRAFT" && <PrintButton />}
      </PageHeader>
      <div className="mb-4 flex items-center gap-2"><QuotePill status={q.status} />{!latest && <span className="muted">A newer version exists.</span>}</div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {q.status === "DRAFT" && manage ? (
            <Card title="Edit draft">
              <QuoteEditor action={a.saveQuoteAction} quoteId={q.id} jobId={q.job.id} scope={q.scope} terms={q.terms} vatRateBps={q.vatRateBps}
                validUntil={q.validUntil?.toISOString().slice(0, 10) ?? ""}
                initial={q.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: String(Number(l.quantity.toString())), unitPrice: (l.unitPriceCents / 100).toFixed(2), taxable: l.taxable }))} />
              <p className="muted mt-3">{org.vatRegistered ? "" : "Your company is not set as VAT registered, so no VAT is added. Change this in Settings before creating a quote."}</p>
            </Card>
          ) : (
            <Card>
              <div className="mb-3 hidden border-b-4 pb-2 print:block" style={{ borderColor: "var(--brand)" }}><p className="text-xl font-extrabold">{org.name}</p><p className="text-sm">For: {q.job.client.name} · {q.job.site.name} · {q.job.reference}</p></div>
              <QuoteDocument q={q} />
              {q.attachments.length > 0 && <div className="no-print mt-3 flex flex-wrap gap-2">{q.attachments.map((f) => <a key={f.id} className="btn btn-secondary btn-sm" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">📄 {f.filename}</a>)}</div>}
            </Card>
          )}

          {q.decision && (
            <Card title="Customer decision">
              <p className="text-sm"><strong>{q.decision.outcome === "APPROVED" ? "Approved" : "Rejected"}</strong> by {q.decision.deciderName}{q.decision.deciderEmail && ` <${q.decision.deciderEmail}>`} on {fmtDateTime(q.decision.createdAt)}</p>
              <p className="muted">{{ LINK: "Decided by the customer through a secure review link.", PORTAL: "Decided by the customer in the portal.", IN_PERSON: "Signed in person.", INTERNAL: "Recorded by staff on the customer's behalf." }[q.decision.via]}</p>
              {q.decision.comment && <p className="mt-1 text-sm italic">“{q.decision.comment}”</p>}
            </Card>
          )}
        </div>

        <div className="no-print space-y-5">
          {q.status === "SUBMITTED" && customer && (
            <Card title="Your decision">
              <Form action={a.portalQuoteAction} hidden={{ quoteId: q.id }}>
                <Select label="Decision" name="outcome" required options={DECISION} />
                <TextArea label="Comments" name="comment" rows={2} hint="Required if you reject." />
                <Submit>Record my decision</Submit>
              </Form>
            </Card>
          )}
          {q.status === "SUBMITTED" && manage && (
            <>
              <Card title="Send to customer">
                <LinkForm action={a.sendLinkAction} hidden={{ quoteId: q.id }} submit="Create secure review link" shareLabel="Review link created">
                  <Field label="Recipient name" name="recipientName" required defaultValue={q.job.client.contactName} />
                  <Field label="Recipient email" name="recipientEmail" type="email" required defaultValue={q.job.client.email} />
                </LinkForm>
                {q.links.length > 0 && <ul className="mt-3 space-y-1 text-xs text-gray-700">{q.links.map((l) => <li key={l.id}>Sent to {l.recipientName} · expires {fmtDateTime(l.expiresAt)}</li>)}</ul>}
              </Card>
              <Card title="Record a decision received another way">
                <Form action={a.recordQuoteDecisionAction} hidden={{ quoteId: q.id }}>
                  <Select label="Decision" name="outcome" required options={DECISION} />
                  <Field label="Customer's name" name="name" required />
                  <TextArea label="How was it given?" name="comment" required rows={2} placeholder="e.g. Purchase order 4471 received by email" />
                  <Submit className="btn btn-secondary">Record decision</Submit>
                </Form>
              </Card>
            </>
          )}
          {manage && latest && (q.status === "SUBMITTED" || q.status === "REJECTED") && (
            <Card title="Revise">
              <p className="muted mb-2">Creates version {q.version + 1} as a new draft. This version is kept in the history{q.status === "SUBMITTED" ? " and its review links stop working" : ""}.</p>
              <ActionButton action={a.reviseQuoteAction} hidden={{ quoteId: q.id }} className="btn btn-secondary">Create revision</ActionButton>
            </Card>
          )}
          <Card title="Version history">
            <ul className="space-y-2 text-sm" data-testid="quote-versions">
              {q.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  {v.id === q.id ? <strong>Version {v.version}</strong> : <Link className="link" href={`/quotes/${v.id}`}>Version {v.version}</Link>}
                  <span className="tabular-nums">{formatZar(v.totalCents)}</span><QuotePill status={v.status} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
