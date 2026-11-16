import { requireSession } from "@/app/_lib/session";
import { Empty, JobList, PageHeader } from "@/components/ui";
import { listJobs } from "@/server/services/jobs";

export const metadata = { title: "My jobs" };

export default async function MyJobs() {
  const { ctx } = await requireSession();
  const jobs = await listJobs(ctx, { view: "mine" });
  const order = ["IN_PROGRESS", "ASSIGNED", "ASSESSING", "ON_HOLD"];
  jobs.sort((a, b) => (order.indexOf(a.status) + 9) % 9 - (order.indexOf(b.status) + 9) % 9 || (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
  return (
    <>
      <PageHeader title="My jobs" subtitle="Open work assigned to you, most urgent first." />
      <JobList jobs={jobs} empty={<Empty title="No jobs assigned to you">When a manager assigns you a job it will appear here and you will get an alert.</Empty>} />
    </>
  );
}
