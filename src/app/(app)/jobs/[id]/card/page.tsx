import { notFound } from "next/navigation";
import { requireSession } from "@/app/_lib/session";
import Link from "@/components/link";
import { PageHeader } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { getJob } from "@/server/services/jobs";
import { CardViewer } from "./viewer";

export const metadata = { title: "Job card" };

/** The branded job card PDF shown inside the app, with Print and Download. Phones open the PDF directly. */
export default async function JobCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const { ctx } = await requireSession();
  const job = await getJob(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const src = `/api/jobs/${job.id}/documents/card`;
  return (
    <>
      <PageHeader title={`Job card ${job.reference}`} subtitle={job.title}>
        <Link href={`/jobs/${job.id}`} className="btn btn-secondary">← Back to the job</Link>
      </PageHeader>
      <CardViewer src={src} autoPrint={(await searchParams).print === "1"} />
    </>
  );
}
