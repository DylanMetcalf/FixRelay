import { RootCauseFields, SignLine } from "@/components/requisition-fields";
import { contractorCompletionAction, contractorQuoteAction } from "@/app/actions/jobs";
import { Form, Submit } from "@/components/form";
import { PublicMessage, PublicShell } from "@/components/public-shell";
import { Card, Field, fmtDate, fmtDateTime, Pill, PriorityBadge, TextArea } from "@/components/ui";
import { formatZar } from "@/lib/money";
import { getContractorLinkView } from "@/server/services/portal";

export const metadata = { title: "Contractor job", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Contractor portal: one job, one contractor. Quote while the site is collecting quotes; completion once appointed. */
export default async function ContractorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await getContractorLinkView(token);
  if (!v) return <PublicMessage title="This link is not valid">It may have been replaced by a newer one. Please contact the site that sent it to you.</PublicMessage>;
  const isQuote = v.purpose === "QUOTE";
  const latest = v.myQuotes[0];
  return (
    <PublicShell org={v.org} logoSrc={v.org.logoAttachmentId ? `/api/public/files/${token}/${v.org.logoAttachmentId}` : null}>
      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">{isQuote ? "Request for quotation" : "Job you have been appointed for"} · for {v.contractor.name}</p>
        <h1 className="text-xl font-extrabold">{v.job.title}</h1>
        <p className="muted">{v.job.reference} · {v.job.site}{v.job.location && ` · ${v.job.location}`}</p>
        <div className="mt-2 flex flex-wrap gap-2"><PriorityBadge priority={v.job.priority} emergency={v.job.emergency} />{isQuote && v.job.quoteDeadline && <Pill tone="amber">Quote by {fmtDate(v.job.quoteDeadline)}</Pill>}</div>
        {v.job.scope && (
          <div className="mt-3 rounded-md border-l-4 border-signal bg-amber-50 p-3" data-testid="rfq-scope">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-700">Work to quote for</p>
            <p className="whitespace-pre-line text-sm">{v.job.scope}</p>
          </div>
        )}
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-600">Fault reported</p>
        <p className="whitespace-pre-line text-sm">{v.job.description}</p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-bold uppercase text-gray-600">Address</dt><dd>{v.job.address || "—"}</dd></div>
          {v.job.asset && <div><dt className="text-xs font-bold uppercase text-gray-600">Equipment</dt><dd>{v.job.asset}</dd></div>}
          {v.job.poNumber && <div><dt className="text-xs font-bold uppercase text-gray-600">Purchase order</dt><dd className="font-bold">{v.job.poNumber}</dd></div>}
          {v.job.approvedCostCents != null && <div><dt className="text-xs font-bold uppercase text-gray-600">Approved value</dt><dd className="font-bold">{formatZar(v.job.approvedCostCents)} incl. VAT</dd></div>}
        </dl>
      </Card>

      {v.files.length > 0 && (
        <Card title="Photos from the site">
          <div className="flex flex-wrap gap-2">
            {v.files.map((f) => f.mimeType.startsWith("image/") ? (
              <a key={f.id} href={`/api/public/files/${token}/${f.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/public/files/${token}/${f.id}`} alt={f.filename} className="h-28 w-28 rounded-md border border-gray-300 object-cover" />
              </a>
            ) : <a key={f.id} href={`/api/public/files/${token}/${f.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">📄 {f.filename}</a>)}
          </div>
        </Card>
      )}

      {isQuote && latest && (
        <Card title="Your quote">
          <p className="text-sm" data-testid="my-quote">Quote {latest.number}{latest.version > 1 ? ` (version ${latest.version})` : ""}: <strong>{formatZar(latest.totalCents)}</strong> incl. VAT · submitted {fmtDateTime(latest.submittedAt)}</p>
          <p className="mt-1 text-sm">Status: <strong>{{ SUBMITTED: "Being considered", APPROVED: "Accepted", REJECTED: "Not selected", SUPERSEDED: "Replaced by a newer version", WITHDRAWN: "Withdrawn", DRAFT: "Draft" }[latest.status]}</strong></p>
        </Card>
      )}

      {v.state === "closed" && <Card title="Closed"><p className="text-sm" data-testid="link-closed">{isQuote ? "This job is no longer collecting quotes. Thank you." : "This job is no longer waiting for your completion."}</p></Card>}
      {v.state === "expired" && <Card title="This link has expired"><p className="text-sm">It expired on {fmtDate(v.expiresAt)}. Please contact {v.org.name}.</p></Card>}
      {v.state === "submitted" && <Card title="Completion received"><p className="text-sm" data-testid="completion-received">Thank you. The site will check the work. If anything needs attention you will receive a new link.</p></Card>}

      {v.state === "open" && isQuote && (
        <Card title={latest ? "Send a revised quote" : "Submit your quote"}>
          <Form action={contractorQuoteAction} hidden={{ token }}>
            <TextArea label="What your price includes" name="scope" required rows={4} placeholder="Work, parts, call-out, exclusions…" />
            <Field label={`Price excl. VAT (R)${v.contractor.vatRegistered ? " – 15% VAT is added" : " – you are not VAT registered with this site"}`} name="price" required inputMode="decimal" placeholder="e.g. 6 850.00" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Can start within (days)" name="leadTimeDays" inputMode="numeric" />
              <Field label="Quote valid until" name="validUntil" type="date" />
            </div>
            <Field label="Your quotation document (PDF or photo)" name="files"><input id="files" name="files" type="file" multiple accept="application/pdf,image/*" className="input" /></Field>
            <p className="text-xs text-gray-600">By submitting, you confirm you are authorised to quote for {v.contractor.name}. The time and your network address are recorded.</p>
            <Submit className="btn btn-primary w-full">{latest ? "Submit revised quote" : "Submit quote"}</Submit>
          </Form>
        </Card>
      )}

      {v.state === "open" && !isQuote && (
        <Card title="Submit completed work">
          <Form action={contractorCompletionAction} hidden={{ token }}>
            <TextArea label="What did you do?" name="workPerformed" required rows={4} />
            <TextArea label="Anything the site should know?" name="observations" rows={2} placeholder="Follow-up work, parts on order, safety notes…" />
            <Field label="Photos of the completed work" name="files" hint="At least one photo is required."><input id="files" name="files" type="file" multiple accept="image/*" capture="environment" className="input" required /></Field>
            <RootCauseFields foodArea={v.job.foodArea} />
            <Field label="Your name" name="signerName" required autoComplete="name" defaultValue={v.contractor.contactName ?? ""} />
            <SignLine label="Work completed by – your signature" required={v.org.requireSignatures} />
            <Submit className="btn btn-primary w-full">Submit completion</Submit>
          </Form>
        </Card>
      )}
    </PublicShell>
  );
}
