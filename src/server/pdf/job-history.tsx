import { Document, Page, Text, View } from "@react-pdf/renderer";
import { formatZar } from "@/lib/money";
import { STATUS_LABEL } from "../workflow";
import { DocFooter, DocHeader, Section } from "./brand";
import type { JobDocumentData } from "./data";
import { fmtDT, s } from "./theme";

const KIND: Record<string, string> = { REQUEST: "Report photo", ASSESSMENT: "Assessment", QUOTE: "Quote document", PROGRESS: "Progress", BEFORE: "Before", AFTER: "After", TEST_DOCUMENT: "Test document", SIGNATURE: "Signature", LOGO: "Logo" };
const UPDATE: Record<string, string> = { PROGRESS: "Progress", CLARIFICATION: "Needs clarification", VARIATION: "More work needed", HOLD: "On hold" };

function Table({ cols, rows, empty }: { cols: { h: string; w: string }[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <Text style={s.muted}>{empty}</Text>;
  return (
    <View style={s.table}>
      <View style={s.tr} fixed>{cols.map((c) => <Text key={c.h} style={[s.th, { width: c.w, paddingRight: 4 }]}>{c.h}</Text>)}</View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {r.map((v, j) => <Text key={j} style={{ width: cols[j]!.w, paddingRight: 4, fontSize: 8.5 }}>{v || "—"}</Text>)}
        </View>
      ))}
    </View>
  );
}

/** FULL JOB HISTORY: every recorded step, handovers, quotes, decisions, comments, reopenings and an attachment index. */
export function JobHistoryDoc({ d }: { d: JobDocumentData }) {
  const { job, name } = d;
  const dept = (id: string | null) => (id ? d.departments[id] ?? "Department" : "");
  const decisions = [
    ...job.quotes.filter((q) => q.decision).map((q) => ({ at: q.decision!.createdAt, what: `Quote ${q.number} v${q.version}${d.seePrices ? ` (${formatZar(q.totalCents)})` : ""}`, d: q.decision! })),
    ...job.completions.filter((c) => c.decision).map((c) => ({ at: c.decision!.createdAt, what: `Completion v${c.version}`, d: c.decision! })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const reopenings = job.events.filter((e) => e.type === "job.reopened");

  return (
    <Document title={`Job history ${job.reference}`} author="Resultra" creator="Resultra" producer="Resultra">
      <Page size="A4" style={s.page}>
        <DocHeader h={{ title: "JOB HISTORY REPORT", numberLabel: "Job no.", number: job.reference, status: STATUS_LABEL[job.status],
          company: d.org, site: { name: job.site.name, address: job.site.address }, generatedAt: d.generatedAt }} />
        <View style={[s.box, { marginTop: 10 }]}>
          <Text style={{ fontWeight: 800, fontSize: 11 }}>{job.title}</Text>
          <Text style={[s.small, s.muted]}>Reported {fmtDT(job.reportedAt)} · {job.events.length} recorded events · reopened {job.reopenCount} time{job.reopenCount === 1 ? "" : "s"}</Text>
        </View>

        <Section title="Activity timeline">
          <Table cols={[{ h: "When", w: "24%" }, { h: "Who", w: "22%" }, { h: "What happened", w: "54%" }]}
            rows={job.events.map((e) => [fmtDT(e.createdAt), e.actorLabel, e.summary])} empty="No activity recorded." />
        </Section>

        {d.staff && (
          <Section title="Ownership and department handovers">
            <Table cols={[{ h: "When", w: "22%" }, { h: "From", w: "20%" }, { h: "To", w: "20%" }, { h: "By", w: "14%" }, { h: "Reason / next action", w: "24%" }]}
              rows={job.handovers.map((h) => [fmtDT(h.createdAt), [dept(h.fromDepartmentId), name(h.fromUserId)].filter(Boolean).join(" · "), [dept(h.toDepartmentId), name(h.toUserId)].filter(Boolean).join(" · "), name(h.byUserId), h.reason])}
              empty="The job has not been handed over between departments." />
          </Section>
        )}

        {job.quotes.length > 0 && (
          <Section title="Quotation history">
            <Table cols={[{ h: "Quote", w: "16%" }, { h: "Contractor", w: "26%" }, { h: "Status", w: "16%" }, { h: "Total incl. VAT", w: "18%" }, { h: "Received", w: "24%" }]}
              rows={job.quotes.map((q) => [`${q.number} v${q.version}`, q.contractor?.name ?? "", q.status.charAt(0) + q.status.slice(1).toLowerCase(), d.seePrices ? formatZar(q.totalCents) : "Restricted", fmtDT(q.submittedAt)])}
              empty="" />
          </Section>
        )}

        <Section title="Approvals and verifications">
          <Table cols={[{ h: "When", w: "22%" }, { h: "Subject", w: "24%" }, { h: "Decision", w: "16%" }, { h: "By", w: "18%" }, { h: "Comment", w: "20%" }]}
            rows={decisions.map((x) => [fmtDT(x.at), x.what, x.d.outcome === "APPROVED" ? "Approved" : "Not approved", x.d.deciderName, x.d.comment])}
            empty="No approvals or verifications recorded." />
        </Section>

        {reopenings.length > 0 && (
          <Section title="Reopening events">
            <Table cols={[{ h: "When", w: "24%" }, { h: "By", w: "22%" }, { h: "Reason", w: "54%" }]} rows={reopenings.map((e) => [fmtDT(e.createdAt), e.actorLabel, e.summary])} empty="" />
          </Section>
        )}

        {d.staff && job.updates.length > 0 && (
          <Section title="Comments and work updates">
            <Table cols={[{ h: "When", w: "22%" }, { h: "Who", w: "18%" }, { h: "Type", w: "14%" }, { h: "Note", w: "46%" }]}
              rows={[...job.updates].reverse().map((u) => [fmtDT(u.createdAt), name(u.authorId), UPDATE[u.kind] ?? u.kind, u.note])} empty="" />
          </Section>
        )}

        <Section title="Attachment index">
          <Table cols={[{ h: "File", w: "40%" }, { h: "Type", w: "18%" }, { h: "Added", w: "24%" }, { h: "By", w: "18%" }]}
            rows={job.attachments.map((a) => [a.filename, KIND[a.kind] ?? a.kind, fmtDT(a.createdAt), a.uploadedById ? name(a.uploadedById) : "Reporter / contractor"])}
            empty="No attachments." />
          <Text style={[s.small, s.muted, { marginTop: 4 }]}>Files are kept in the digital record; open the job in Resultra to view them.</Text>
        </Section>

        <DocFooter reference={`Job history ${job.reference}`} generatedAt={d.generatedAt} qr={d.qr} href={d.link} />
      </Page>
    </Document>
  );
}
