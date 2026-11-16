import { publicDecideAction } from "@/app/actions/jobs";
import { SignaturePad } from "@/components/client";
import { Form, Submit } from "@/components/form";
import { QuoteDocument } from "@/components/quote-doc";
import { ReviewMessage, ReviewShell } from "@/components/review-shell";
import { Card, Field, fmtDate, fmtDateTime, Select, TextArea } from "@/components/ui";
import { getLinkView } from "@/server/services/approvals";

export const metadata = { title: "Review", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Public page for BOTH quote approval (/q/…) and completion verification (/v/…): the link decides which. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await getLinkView(token);
  if (!v) return <ReviewMessage title="This link is not valid">It may have been replaced by a newer one. Please contact the company that sent it to you.</ReviewMessage>;
  const isQuote = v.purpose === "QUOTE";
  const subject = isQuote ? "quotation" : "completed work";
  return (
    <ReviewShell org={v.org} token={token}>
      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">{isQuote ? "Quotation for your approval" : "Completed work for your verification"}</p>
        <h1 className="text-xl font-extrabold">{v.job.title}</h1>
        <p className="muted">{v.job.reference} · {v.job.clientName} · {v.job.siteName}</p>
        <p className="mt-2 whitespace-pre-line text-sm">{v.job.description}</p>
      </Card>

      {v.quote && <Card><QuoteDocument q={v.quote} /></Card>}
      {v.completion && (
        <Card title="Work performed">
          <p className="whitespace-pre-line text-sm">{v.completion.workPerformed}</p>
          {v.completion.observations && <p className="mt-2 text-sm"><strong>Observations:</strong> {v.completion.observations}</p>}
          <p className="muted mt-2">Completed {fmtDateTime(v.completion.completedAt)}</p>
        </Card>
      )}
      {v.attachments.length > 0 && (
        <Card title={isQuote ? "Documents" : "Evidence"}>
          <div className="flex flex-wrap gap-2">
            {v.attachments.map((f) => f.mimeType.startsWith("image/") ? (
              <a key={f.id} href={`/api/public/files/${token}/${f.id}`} target="_blank" rel="noreferrer" className="text-center text-xs text-gray-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/public/files/${token}/${f.id}`} alt={f.filename} className="h-28 w-28 rounded-md border border-gray-300 object-cover" />{f.kind.replace("_", " ").toLowerCase()}
              </a>
            ) : <a key={f.id} href={`/api/public/files/${token}/${f.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">📄 {f.filename}</a>)}
          </div>
        </Card>
      )}

      {v.state === "decided" && (
        <Card title="Decision recorded">
          <p className="text-sm" data-testid="decision-recorded">{v.decision
            ? <>This {subject} was <strong>{v.decision.outcome === "APPROVED" ? "approved" : "rejected"}</strong> by {v.decision.deciderName} on {fmtDateTime(v.decision.createdAt)}.</>
            : <>This {subject} is no longer awaiting a decision.</>} No further action is needed.</p>
        </Card>
      )}
      {v.state === "expired" && <Card title="This link has expired"><p className="text-sm">It expired on {fmtDate(v.expiresAt)}. Please ask {v.org.name} to send you a new link.</p></Card>}
      {v.state === "open" && (
        <Card title="Your decision">
          <Form action={publicDecideAction} hidden={{ token }}>
            <Field label="Your full name" name="name" required defaultValue={v.recipientName} autoComplete="name" />
            <Select label="Decision" name="outcome" required options={isQuote
              ? [{ value: "APPROVED", label: "Approve this quotation" }, { value: "REJECTED", label: "Reject this quotation" }]
              : [{ value: "APPROVED", label: "Approve – the work is complete" }, { value: "REJECTED", label: "Reject – the work is not acceptable" }]} />
            <TextArea label="Comments" name="comment" rows={3} hint="Required if you reject, so it can be put right." />
            {!isQuote && <SignaturePad />}
            <p className="text-xs text-gray-600">By submitting you confirm you are authorised to make this decision for {v.job.clientName}. Your name, the time and your network address are recorded. This link expires on {fmtDate(v.expiresAt)}.</p>
            <Submit className="btn btn-primary w-full">Submit decision</Submit>
          </Form>
        </Card>
      )}
    </ReviewShell>
  );
}
