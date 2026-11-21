import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addJobAttachment } from "@/server/services/attachments";
import * as jobs from "@/server/services/jobs";
import { renderJobDocument } from "@/server/pdf/render";
import { writeFileSync } from "node:fs";
import { appointedJob, code, completedInHouse, member, newJob, photo, readPdf, tenant } from "../helpers";

/** Set PDF_OUT=<dir> to keep the generated files for visual inspection. */
const keep = (name: string, bytes: Buffer) => { if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/${name}`, bytes); };
const has = (text: string, want: string) => expect(text.toLowerCase()).toContain(want.toLowerCase());

describe("branded job documents (PDF)", () => {
  it("job card: A4, branded, real job data, the reported photo kept in proportion, writing space while the job is open", async () => {
    const t = await tenant();
    const job = await newJob(t, t.requester, { priority: "HIGH" });
    await addJobAttachment(t.requester, { jobId: job.id, kind: "REQUEST", filename: "fault.jpg", bytes: await photo(1200, 800) });
    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
    await jobs.submitAssessment(t.tech, job.id, { findings: "Start capacitor degraded", recommendedWork: "Replace capacitor", quoteRequired: false });
    await jobs.routeInHouse(t.manager, job.id);
    await jobs.assignJob(t.manager, job.id, { leadTechnicianId: t.tech.userId, instructions: "Lock out before opening the panel." });

    const { bytes, filename } = await renderJobDocument(t.manager, job.id, "card");
    expect(filename).toBe(`RESULTRA_JobCard_${job.reference}.pdf`);
    keep("card-open.pdf", bytes);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await readPdf(bytes);
    expect(pdf.title).toBe(`Job card ${job.reference}`);
    expect(pdf.pages[0]!.width).toBeCloseTo(595.28, 0); // A4 portrait
    expect(pdf.pages[0]!.height).toBeCloseTo(841.89, 0);
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: t.orgId } });
    for (const want of ["MAINTENANCE JOB CARD", job.reference, org.name, "Germiston Plant", "Cold Room 2", "Compressor tripping", "Trips after 20 minutes.",
      "High", "Start capacitor degraded", "Replace capacitor", "Lock out before opening the panel.", "Assigned", "Reported photo", "Work performed",
      "Technician name", "Manager verification", "SAST", "Resultra"]) has(pdf.text, want);
    expect(pdf.text).toMatch(/Page 1 of \d/);
    expect(pdf.pages.reduce((n, p) => n + p.images, 0)).toBeGreaterThanOrEqual(2); // the photo and the footer QR code
    for (const p of pdf.pages) expect(p.text.replace(/Resultra|Page \d+ of \d+|Snapshot generated.*$/g, "").trim().length).toBeGreaterThan(20); // no empty pages
  });

  it("long descriptions wrap onto further pages with the header content once and a footer on every page", async () => {
    const t = await tenant();
    const long = Array.from({ length: 52 }, (_, i) => `Line ${i + 1}: the conveyor drive keeps tripping when the line speeds up after the break.`).join(" ");
    const job = await newJob(t, t.requester, { description: long });
    const long1 = await renderJobDocument(t.manager, job.id, "card");
    keep("card-long.pdf", long1.bytes);
    const pdf = await readPdf(long1.bytes);
    expect(pdf.pages.length).toBeGreaterThan(1);
    expect(pdf.text).toContain("Line 52:"); // nothing clipped
    pdf.pages.forEach((p, i) => expect(p.text).toContain(`Page ${i + 1} of ${pdf.pages.length}`));
    expect(pdf.text.match(/MAINTENANCE JOB CARD/g)!.length).toBe(1);
  });

  it("completion report: before and after photos, work performed, verification and signatures only where recorded", async () => {
    const t = await tenant();
    await expect(renderJobDocument(t.manager, (await newJob(t)).id, "completion")).rejects.toEqual(code("CONFLICT")); // not completed yet
    const { job } = await completedInHouse(t);
    await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "after-wide.jpg", bytes: await photo(1600, 900, "#16a34a") });
    let pdf = await readPdf((await renderJobDocument(t.manager, job.id, "completion")).bytes);
    expect(pdf.text).toContain("COMPLETED JOB REPORT");
    expect(pdf.text).toContain("Replaced the capacitor and tested.");
    expect(pdf.text).toContain("Wear and tear");
    expect(pdf.text).toContain("No verification has been recorded yet.");
    expect(pdf.text).toContain("not closed yet");
    expect(pdf.text).toContain("No signature recorded."); // blank lines never imply approval
    await jobs.confirmFixed(t.requester, job.id, { outcome: "APPROVED", comment: "Running well now" });
    await jobs.closeJob(t.manager, job.id);
    const { bytes, filename } = await renderJobDocument(t.requester, job.id, "completion"); // the reporter may download it
    expect(filename).toBe(`RESULTRA_CompletionReport_${job.reference}.pdf`);
    keep("completion.pdf", bytes);
    pdf = await readPdf(bytes);
    expect(pdf.text).toContain("Final status: Closed");
    expect(pdf.text).toContain(`Confirmed fixed by ${t.requester.userName}`);
    expect(pdf.text).toContain("Running well now");
    expect(pdf.pages.reduce((n, p) => n + p.images, 0)).toBeGreaterThanOrEqual(3);
  });

  it("history report: timeline, quotes and approvals for staff; not available to reporters; prices only for those allowed", async () => {
    const t = await tenant();
    const { job } = await appointedJob(t);
    const hist = await renderJobDocument(t.manager, job.id, "history");
    keep("history.pdf", hist.bytes);
    const pdf = await readPdf(hist.bytes);
    for (const want of ["JOB HISTORY REPORT", "Activity timeline", "Quotation history", "Approvals and verifications", "Attachment index"]) has(pdf.text, want);
    expect(pdf.text).toContain("CoolTech");
    expect(pdf.text).toContain("Approved");
    expect(pdf.text).toMatch(/R\s?3\s?\d{3}/); // the manager sees amounts
    await expect(renderJobDocument(t.requester, job.id, "history")).rejects.toEqual(code("FORBIDDEN"));
    const card = await readPdf((await renderJobDocument(t.requester, job.id, "card")).bytes);
    expect(card.text).not.toMatch(/R\s?3\s?\d{3},\d\d/); // the reporter never sees prices
  });

  it("documents are only generated for people who can see the job", async () => {
    const t = await tenant();
    const other = await tenant();
    const job = await newJob(t);
    await expect(renderJobDocument(other.manager, job.id, "card")).rejects.toEqual(code("NOT_FOUND"));
    const outsider = await member(t.orgId, ["TECHNICIAN"]);
    await expect(renderJobDocument(outsider, job.id, "card")).rejects.toEqual(code("NOT_FOUND"));
    const someoneElse = await member(t.orgId, ["REQUESTER"]);
    await expect(renderJobDocument(someoneElse, job.id, "card")).rejects.toEqual(code("NOT_FOUND"));
  });
});
