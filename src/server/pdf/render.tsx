/**
 * Entry point for job documents. Each function checks access, loads live data, and returns the PDF bytes plus a
 * descriptive file name. PDFs are generated on request and never stored, so there are no stale copies to leak.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import { conflict, forbidden } from "@/lib/errors";
import { isStaff, type Ctx } from "../permissions";
import { CompletionReportDoc } from "./completion-report";
import { loadJobDocument } from "./data";
import { JobCardDoc } from "./job-card";
import { JobHistoryDoc } from "./job-history";
import { registerFonts } from "./theme";

export type JobDocKind = "card" | "completion" | "history";
export const DOC_KINDS: JobDocKind[] = ["card", "completion", "history"];

const safeRef = (ref: string) => ref.replace(/[^\w-]+/g, "_");

export async function renderJobDocument(ctx: Ctx, jobId: string, kind: JobDocKind): Promise<{ bytes: Buffer; filename: string }> {
  registerFonts();
  if (kind === "history" && !isStaff(ctx)) throw forbidden("The full job history is available to the maintenance team and managers.");
  const d = await loadJobDocument(ctx, jobId);
  const ref = safeRef(d.job.reference);
  if (kind === "card") {
    const photos = await d.loadPhotos(["REQUEST", "BEFORE"], 4);
    return { bytes: await renderToBuffer(<JobCardDoc d={d} photos={photos} />), filename: `MANOP_JobCard_${ref}.pdf` };
  }
  if (kind === "completion") {
    if (d.job.completions.length === 0) throw conflict("The completion report is available once the work has been completed.");
    const [before, after] = [await d.loadPhotos(["REQUEST", "BEFORE"], 4), await d.loadPhotos(["AFTER"], 6)];
    return { bytes: await renderToBuffer(<CompletionReportDoc d={d} before={before} after={after} />), filename: `MANOP_CompletionReport_${ref}.pdf` };
  }
  return { bytes: await renderToBuffer(<JobHistoryDoc d={d} />), filename: `MANOP_JobHistory_${ref}.pdf` };
}
