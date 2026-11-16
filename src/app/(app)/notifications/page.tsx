import Link from "@/components/link";
import { markReadAction } from "@/app/actions/auth";
import { requireSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Empty, fmtDateTime, PageHeader } from "@/components/ui";
import { listNotifications } from "@/server/services/notifications";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const { ctx } = await requireSession();
  const items = await listNotifications(ctx);
  return (
    <>
      <PageHeader title="Notifications">
        {items.some((n) => !n.readAt) && <Form action={markReadAction}><Submit className="btn btn-secondary">Mark all as read</Submit></Form>}
      </PageHeader>
      {items.length === 0 ? <Empty title="No notifications yet">You will be alerted here when something needs your attention.</Empty> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.jobId ? `/jobs/${n.jobId}` : "#"} className={`card block !p-3 ${n.readAt ? "" : "!border-l-4 !border-l-amber-500"}`}>
                <p className={`text-sm ${n.readAt ? "font-semibold text-gray-700" : "font-extrabold text-gray-900"}`}>{n.title}</p>
                {n.body && <p className="muted whitespace-pre-line">{n.body}</p>}
                <p className="mt-1 text-xs text-gray-500">{fmtDateTime(n.createdAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
