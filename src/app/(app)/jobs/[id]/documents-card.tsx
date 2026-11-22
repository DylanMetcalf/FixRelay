import Link from "@/components/link";
import { Card } from "@/components/ui";
import { isStaff, type Ctx } from "@/server/permissions";
import type { JobView } from "@/server/services/jobs";

/** Job card, completion report and history: view, print or download. Files are generated fresh each time. */
export function DocumentsCard({ job, ctx }: { job: JobView; ctx: Ctx }) {
  const base = `/api/jobs/${job.id}/documents`;
  const done = job.completions.length > 0;
  return (
    <Card title="Job card and documents">
      <div className="space-y-2" data-testid="documents">
        <div className="grid grid-cols-3 gap-2">
          <Link href={`/jobs/${job.id}/card`} className="btn btn-primary btn-sm">View job card</Link>
          <a href={`${base}/card?download=1`} className="btn btn-secondary btn-sm" download>Download PDF</a>
          <Link href={`/jobs/${job.id}/card?print=1`} className="btn btn-secondary btn-sm">Print</Link>
        </div>
        {done
          ? <a href={`${base}/completion?download=1`} className="btn btn-secondary btn-sm w-full" download>Download completion report</a>
          : <p className="text-xs text-gray-600">The completion report becomes available once the work is completed.</p>}
        {isStaff(ctx) && <a href={`${base}/history?download=1`} className="btn btn-secondary btn-sm w-full" download>Export job history (PDF)</a>}
        <Link href={`/jobs/${job.id}/report`} className="link block text-sm">Open the paper-style requisition</Link>
        <p className="text-xs text-gray-600">Each PDF is a snapshot of the job when you open it.</p>
      </div>
    </Card>
  );
}
