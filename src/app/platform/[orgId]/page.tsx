import { notFound, redirect } from "next/navigation";
import { resendCustomerInviteAction } from "@/app/actions/admin";
import { getSession } from "@/app/_lib/session";
import { LinkForm } from "@/components/client-forms";
import Link from "@/components/link";
import { Card, fmtDate, fmtDateTime, Pill } from "@/components/ui";
import { customerDetail } from "@/server/services/platform";

export const metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

/** One customer's account details for the platform owner (no jobs, quotes, photos or reports). */
export default async function Customer({ params }: { params: Promise<{ orgId: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login?next=/platform");
  if (!s.user.isPlatformAdmin) redirect("/forbidden");
  const { orgId } = await params;
  const c = /^[0-9a-f-]{36}$/.test(orgId) ? await customerDetail(s.user, orgId) : null;
  if (!c) notFound();
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Link href="/platform" className="btn btn-secondary btn-sm">← All customers</Link>
      <div>
        <h1 className="text-2xl font-extrabold">{c.org.name}</h1>
        <p className="muted">{[c.org.contactEmail, c.org.phone, c.org.address].filter(Boolean).join(" · ")} · created {fmtDate(c.org.createdAt)} · {c.org.subscription?.plan.name} ({c.org.subscription?.status}) · QR reporting {c.org.publicReportingEnabled ? "on" : "off"}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Card title={`Users (${c.members.length})`}>
          <ul className="divide-y divide-gray-200 text-sm" data-testid="customer-users">
            {c.members.map((m) => (
              <li key={m.userId} className="py-2">
                <p className="font-bold">{m.user.name}{m.user.jobTitle && <span className="font-normal text-gray-700"> · {m.user.jobTitle}</span>} {m.status === "PENDING" && <Pill tone="amber">Waiting for approval</Pill>}{m.status === "REJECTED" && <Pill tone="red">Declined</Pill>}{m.status === "ACTIVE" && !m.active && <Pill tone="red">Access removed</Pill>}</p>
                <p className="text-gray-700">{m.user.email}{!m.user.emailVerifiedAt && " · email not confirmed"}</p>
                <p className="text-xs text-gray-600">{m.roles.join(", ").toLowerCase()}{m.departments.length ? ` · ${m.departments.join(", ")}` : ""} · since {fmtDate(m.createdAt)}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-gray-200 pt-3">
            <LinkForm action={resendCustomerInviteAction} hidden={{ orgId: c.org.id }} submit="Re-send the administrator invitation" shareLabel="New invitation link"><p className="text-xs text-gray-600">Replaces any open invitation for the main contact.</p></LinkForm>
          </div>
        </Card>
        <div className="space-y-5">
          <Card title={`Sites (${c.sites.length})`}>
            <ul className="space-y-1 text-sm">{c.sites.map((x) => <li key={x.id}>{x.name}{x.address && <span className="text-gray-600"> · {x.address}</span>} · {x._count.locations} area(s){x.archived && " · archived"}</li>)}</ul>
          </Card>
          <Card title={`Departments (${c.departments.length})`}>
            <ul className="space-y-1 text-sm">{c.departments.map((x) => <li key={x.id}>{x.name} · {x.members} member(s)</li>)}</ul>
          </Card>
          <Card title="Email delivery failures">
            {c.failures.length === 0 ? <p className="muted">None.</p> : <ul className="space-y-1 text-xs">{c.failures.map((f) => <li key={f.id}>{fmtDateTime(f.createdAt)} · {f.toEmail}: {f.lastError?.slice(0, 160)}</li>)}</ul>}
          </Card>
        </div>
      </div>
    </main>
  );
}
