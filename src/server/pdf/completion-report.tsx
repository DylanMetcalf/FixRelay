import { Document, Page, Text, View } from "@react-pdf/renderer";
import { formatZar } from "@/lib/money";
import { PRIORITY_LABEL, ROOT_CAUSE_LABEL, STATUS_LABEL } from "../workflow";
import { DocFooter, DocHeader, Fields, Section } from "./brand";
import type { JobDocumentData, Photo } from "./data";
import { Para, PhotoGrid, SignatureBlock } from "./parts";
import { C, fmtDT, s } from "./theme";

const VIA: Record<string, string> = { LINK: "secure link", PORTAL: "signed in to Resultra", IN_PERSON: "in person, signed on a staff device", INTERNAL: "by a manager on the reporter's behalf" };

/**
 * COMPLETED JOB REPORT: the formal record of what was asked for, what was approved, what was done, the evidence
 * and who verified it. Approvals and signatures appear only where they were actually recorded.
 */
export function CompletionReportDoc({ d, before, after }: { d: JobDocumentData; before: { photos: Photo[]; more: number }; after: { photos: Photo[]; more: number } }) {
  const { job, name } = d;
  const completion = job.completions.find((c) => c.status === "APPROVED") ?? job.completions[0]!;
  const assessment = job.assessments[0];
  const approved = job.quotes.find((q) => q.status === "APPROVED");
  const reporter = job.requesterId ? name(job.requesterId) : `${job.reporterName ?? "Unknown"} (QR / site link)`;
  const doer = completion.submittedById ? name(completion.submittedById) : job.contractor?.name ?? "Contractor";
  const closed = job.events.filter((e) => e.type === "job.closed").at(-1);
  const sig = (step: string) => d.signatures.filter((x) => x.step === step).at(-1);
  const verification = completion.decision;
  const final = job.status === "CLOSED" ? `Closed ${fmtDT(job.closedAt)}` : `${STATUS_LABEL[job.status]} – not closed yet when this report was generated`;

  return (
    <Document title={`Completed job report ${job.reference}`} author="Resultra" creator="Resultra" producer="Resultra">
      <Page size="A4" style={s.page}>
        <DocHeader h={{ title: "COMPLETED JOB REPORT", numberLabel: "Job no.", number: job.reference, status: STATUS_LABEL[job.status],
          company: d.org, site: { name: job.site.name, address: job.site.address }, generatedAt: d.generatedAt }} />

        <View style={[s.box, { marginTop: 10, backgroundColor: job.status === "CLOSED" ? "#F0FDF4" : C.mist, borderColor: job.status === "CLOSED" ? "#86EFAC" : C.line }]}>
          <Text style={{ fontWeight: 800, color: job.status === "CLOSED" ? C.green : C.navy }}>Final status: {final}</Text>
          {closed && <Text style={[s.small, s.muted]}>Closed by {closed.actorLabel}.</Text>}
        </View>

        <Section title="Original request">
          <View style={[s.box, { marginBottom: 6, borderLeftWidth: 3, borderLeftColor: C.amber }]}>
            <Text style={{ fontSize: 11, fontWeight: 800 }}>{job.title}</Text>
            <Text style={[s.body, { marginTop: 3 }]}>{job.description}</Text>
          </View>
          <Fields items={[
            { label: "Reported", value: fmtDT(job.reportedAt) }, { label: "Reported by", value: reporter },
            { label: "Area", value: job.location?.name ?? "Somewhere on site" }, { label: "Equipment", value: job.asset ? `${job.asset.reference} – ${job.asset.name}` : "" },
            { label: "Priority", value: PRIORITY_LABEL[job.priority] }, { label: "Category", value: job.category },
          ]} />
        </Section>

        <Section title="Before" minPresenceAhead={180}>
          <PhotoGrid photos={before.photos} more={before.more} empty="No before photographs were recorded." boxH={150} />
        </Section>

        <Section title="Assessment and approved scope">
          <Fields items={[
            { label: "Assessment summary", value: assessment?.findings ?? (d.staff ? "No assessment recorded" : ""), wide: true },
            { label: "Approved work scope", value: approved ? approved.scope : assessment?.recommendedWork ?? "", wide: true },
            ...(approved ? [
              { label: "Approved quotation", value: `${approved.number} v${approved.version}${approved.contractor ? ` · ${approved.contractor.name}` : ""}` },
              { label: "Approved amount", value: d.seePrices ? formatZar(approved.totalCents) : "Restricted" },
            ] : []),
          ]} />
        </Section>

        <Section title="Work performed">
          <View style={s.box}>
            <Para label="Work performed" text={completion.workPerformed} />
            <Para label="Completion notes and observations" text={completion.observations} />
            <Fields items={[
              { label: "Completed", value: fmtDT(completion.completedAt) },
              { label: job.route === "CONTRACTOR" && !completion.submittedById ? "Contractor" : "Technician", value: doer },
              { label: "Root cause", value: completion.rootCauses.map((r) => ROOT_CAUSE_LABEL[r]).join(", ") },
              { label: "Root cause notes", value: completion.rootCauseNotes },
              ...(completion.toolsAndAreaOk !== null ? [{ label: "Tools out = tools in, area clean", value: completion.toolsAndAreaOk ? "Yes" : "No" }] : []),
            ]} />
          </View>
        </Section>

        <Section title="After" minPresenceAhead={180}>
          <PhotoGrid photos={after.photos} more={after.more} empty="No after photographs were recorded." boxH={150} />
        </Section>

        <Section title="Verification and approval" wrap={false}>
          <View style={[s.box, { marginBottom: 8 }]}>
            {verification ? (
              <>
                <Text style={{ fontWeight: 800, color: verification.outcome === "APPROVED" ? C.green : C.red }}>
                  {verification.outcome === "APPROVED" ? "Confirmed fixed" : "Not fixed – sent back"} by {verification.deciderName}
                </Text>
                <Text style={[s.small, s.muted]}>{fmtDT(verification.createdAt)} · {VIA[verification.via] ?? verification.via}</Text>
                {verification.comment && <Text style={{ marginTop: 3 }}>“{verification.comment}”</Text>}
              </>
            ) : <Text style={s.muted}>No verification has been recorded yet.</Text>}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SignatureBlock label="Work completed by" sig={sig("COMPLETED")} />
            <SignatureBlock label="Confirmed by originator" sig={sig("ORIGINATOR")} />
            <SignatureBlock label="Manager sign-off" sig={sig("MANAGER")} />
          </View>
        </Section>

        <DocFooter reference={`Completed job report ${job.reference}`} generatedAt={d.generatedAt} qr={d.qr} href={d.link} />
      </Page>
    </Document>
  );
}
