import { Document, Page, Text, View } from "@react-pdf/renderer";
import { formatZar } from "@/lib/money";
import { PRIORITY_LABEL, ROUTE_LABEL, SPARES_LABEL, STATUS_LABEL } from "../workflow";
import { DocFooter, DocHeader, Fields, Section } from "./brand";
import type { JobDocumentData, Photo } from "./data";
import { Para, PhotoGrid, SignatureBlock, WriteBox } from "./parts";
import { C, fmtD, fmtDT, s } from "./theme";

const QUOTE_STATUS: Record<string, string> = {
  DRAFT: "Draft", REQUESTED: "Requested", SUBMITTED: "Received", APPROVED: "Approved", REJECTED: "Not approved", SUPERSEDED: "Replaced by a revision", WITHDRAWN: "Withdrawn", EXPIRED: "Expired",
};

/**
 * MAINTENANCE JOB CARD (A4 portrait): the active job as it stands, with space to write the work up by hand if the
 * card is printed and taken to the job. Completion details already recorded are shown instead of blank lines.
 */
export function JobCardDoc({ d, photos }: { d: JobDocumentData; photos: { photos: Photo[]; more: number } }) {
  const { job, name } = d;
  const reporter = job.requesterId ? name(job.requesterId) : `${job.reporterName ?? "Unknown"} (QR / site link)`;
  const assessment = job.assessments[0];
  const completion = job.completions[0];
  const approved = job.quotes.find((q) => q.status === "APPROVED");
  const latestQuote = approved ?? job.quotes.find((q) => q.status === "SUBMITTED");
  const techs = [job.leadTechnicianId ? `${name(job.leadTechnicianId)} (lead)` : "", ...job.technicians.filter((t) => t.userId !== job.leadTechnicianId).map((t) => name(t.userId))].filter(Boolean).join(", ");
  const responsible = job.route === "CONTRACTOR" && job.contractor ? `${job.contractor.name} (contractor)` : techs || (job.ownerId ? `${name(job.ownerId)} (manager)` : "Not assigned yet");
  const workDate = job.plannedStart || job.plannedEnd
    ? [job.plannedStart && fmtD(job.plannedStart), job.plannedEnd && fmtD(job.plannedEnd)].filter(Boolean).join(" – ")
    : job.dueAt ? `Due ${fmtD(job.dueAt)}` : "";
  const sig = (step: string) => d.signatures.filter((x) => x.step === step).at(-1);

  return (
    <Document title={`Job card ${job.reference}`} author="Resultra" subject={`Maintenance job card for ${job.title}`} creator="Resultra" producer="Resultra">
      <Page size="A4" style={s.page}>
        <DocHeader h={{ title: "MAINTENANCE JOB CARD", numberLabel: "Job card no.", number: job.reference, status: STATUS_LABEL[job.status],
          company: d.org, site: { name: job.site.name, address: job.site.address }, generatedAt: d.generatedAt }} />

        <Section title="Reported issue">
          <View style={[s.box, { marginBottom: 6, borderLeftWidth: 3, borderLeftColor: C.amber }]}>
            <Text style={{ fontSize: 11.5, fontWeight: 800 }}>{job.title}</Text>
            <Text style={[s.body, { marginTop: 3 }]}>{job.description}</Text>
          </View>
          <Fields items={[
            { label: "Reported", value: fmtDT(job.reportedAt) },
            { label: "Reported by", value: reporter },
            { label: "Area", value: job.location?.name ?? "Somewhere on site" },
            { label: "Equipment", value: job.asset ? `${job.asset.reference} – ${job.asset.name}` : "" },
            { label: "Category", value: job.category },
            { label: "Priority", value: `${PRIORITY_LABEL[job.priority]}${job.emergency ? " · EMERGENCY" : ""}` },
            { label: "Request reference", value: job.reference },
            { label: "Department", value: job.department?.name ?? "" },
          ]} />
        </Section>

        <Section title="Photographs" minPresenceAhead={180}>
          <PhotoGrid photos={photos.photos} more={photos.more} empty="No photograph was added to this report." />
        </Section>

        <Section title="Assessment and assignment">
          <Fields items={[
            { label: "Assigned department", value: job.department?.name ?? "" },
            { label: "Responsible", value: responsible },
            { label: "Fixed by", value: ROUTE_LABEL[job.route] },
            { label: "Expected work date", value: workDate },
            { label: "Assessment summary", value: assessment ? `${assessment.findings}${assessment.suspectedCause ? ` Likely cause: ${assessment.suspectedCause}` : ""}` : d.staff ? "Not assessed yet" : "", wide: true },
            { label: "Recommended repair", value: assessment?.recommendedWork ?? "", wide: true },
            ...(job.instructions ? [{ label: "Work instructions", value: job.instructions, wide: true }] : []),
            ...(job.sparesStatus !== "NOT_NEEDED" ? [{ label: "Spares", value: `${SPARES_LABEL[job.sparesStatus]}${job.sparesList ? `: ${job.sparesList}` : ""}`, wide: true }] : []),
          ]} />
        </Section>

        {(job.route === "CONTRACTOR" || job.quotes.length > 0) && (
          <Section title="Quotation and approval">
            <Fields items={[
              { label: "Quotation reference", value: latestQuote ? `${latestQuote.number} v${latestQuote.version}${latestQuote.contractor ? ` · ${latestQuote.contractor.name}` : ""}` : d.seePrices ? "No quotation yet" : "Restricted" },
              { label: "Approval status", value: latestQuote ? QUOTE_STATUS[latestQuote.status] ?? latestQuote.status : job.status === "AWAITING_APPROVAL" ? "Waiting for approval" : "" },
              ...(d.seePrices && approved ? [{ label: "Approved amount (incl. VAT)", value: formatZar(approved.totalCents) }, { label: "Purchase order", value: job.poNumber ?? "" }] : []),
            ]} />
            {!d.seePrices && <Text style={[s.small, s.muted, { marginTop: 3 }]}>Amounts are only shown to people allowed to see prices.</Text>}
          </Section>
        )}

        {completion ? (
          <Section title="Work completed (recorded)" wrap={false}>
            <View style={s.box}>
              <Para label="Work performed" text={completion.workPerformed} />
              <Para label="Observations" text={completion.observations} />
              <Text style={[s.small, s.muted]}>Completed {fmtDT(completion.completedAt)}{completion.submittedById ? ` by ${name(completion.submittedById)}` : job.contractor ? ` by ${job.contractor.name}` : ""}. Full details are in the completion report.</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <SignatureBlock label="Work completed by" sig={sig("COMPLETED")} />
              <SignatureBlock label="Confirmed by originator" sig={sig("ORIGINATOR")} />
              <SignatureBlock label="Manager sign-off" sig={sig("MANAGER")} />
            </View>
          </Section>
        ) : (
          <Section title="Work completion (fill in by hand)" wrap={false} minPresenceAhead={300}>
            <View style={s.box}>
              <WriteBox label="Work performed" lines={4} />
              <WriteBox label="Parts and materials used" lines={2} />
              <WriteBox label="Additional observations" lines={2} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <WriteBox label="Technician name" lines={1} grow={1.4} />
                <WriteBox label="Date" lines={1} grow={1} />
                <WriteBox label="Signature" lines={1} grow={1.4} />
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <WriteBox label="Manager verification – name" lines={1} grow={1.4} />
                <WriteBox label="Date" lines={1} grow={1} />
                <WriteBox label="Signature" lines={1} grow={1.4} />
              </View>
              <Text style={[s.small, s.muted]}>Handwritten entries are not part of the digital record until they are entered in Resultra.</Text>
            </View>
          </Section>
        )}

        <DocFooter reference={`Job card ${job.reference}`} generatedAt={d.generatedAt} qr={d.qr} href={d.link} />
      </Page>
    </Document>
  );
}
