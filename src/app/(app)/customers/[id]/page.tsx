import Link from "@/components/link";
import { notFound } from "next/navigation";
import * as a from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { LinkForm } from "@/components/client-forms";
import { Form, Submit } from "@/components/form";
import { Card, Empty, Field, JobList, PageHeader, Pill, TextArea } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { can } from "@/server/permissions";
import { getClient } from "@/server/services/clients";
import { listJobs } from "@/server/services/jobs";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePage("clients.view");
  const { id } = await params;
  const c = await getClient(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const jobs = await listJobs(ctx, { clientId: c.id }, 20);
  const manage = can(ctx, "clients.manage");
  return (
    <>
      <PageHeader title={c.name} subtitle={<>{c.contactName}{c.email && ` · ${c.email}`}{c.phone && ` · ${c.phone}`}</>}>
        <Link href="/requests/new" className="btn btn-primary">+ New request</Link>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Sites and locations">
            {c.sites.length === 0 ? <p className="muted">No sites yet. Add the first site so requests can be logged against it.</p> : (
              <ul className="space-y-4">
                {c.sites.map((s) => (
                  <li key={s.id} className="rounded-md border border-gray-300 p-3">
                    <p className="font-bold">{s.name} <span className="text-xs font-semibold text-gray-600">· {s._count.assets} asset{s._count.assets === 1 ? "" : "s"}</span></p>
                    {s.address && <p className="muted">{s.address}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">{s.locations.map((l) => <Pill key={l.id}>{l.name}</Pill>)}</div>
                    {manage && (
                      <Form action={a.createLocationAction} hidden={{ siteId: s.id }} className="mt-2 flex flex-wrap items-end gap-2">
                        <input name="name" aria-label={`New location at ${s.name}`} placeholder="Add a location, e.g. Plant room" className="input max-w-xs !min-h-9 text-sm" required />
                        <Submit className="btn btn-secondary btn-sm">Add location</Submit>
                      </Form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manage && (
              <details className="action mt-4" open={c.sites.length === 0}><summary>Add a site</summary>
                <Form action={a.createSiteAction} hidden={{ clientId: c.id }}>
                  <Field label="Site name" name="name" required placeholder="e.g. Germiston Depot" />
                  <Field label="Address" name="address" />
                  <Submit>Add site</Submit>
                </Form>
              </details>
            )}
          </Card>
          <div>
            <h2 className="mb-3 text-lg font-extrabold">Recent jobs</h2>
            <JobList jobs={jobs} empty={<Empty title="No jobs for this customer yet" />} />
          </div>
        </div>
        <div className="space-y-5">
          <Card title="Customer portal users">
            <p className="muted mb-2">Client representatives can log requests, follow their jobs, approve quotes and sign off work. They only ever see this customer's jobs.</p>
            <ul className="mb-3 space-y-1 text-sm">{c.memberships.map((m) => <li key={m.id}>{m.user.name} <span className="text-gray-600">· {m.user.email} · {m.roles.join(", ").toLowerCase()}{!m.active && " · access removed"}</span></li>)}</ul>
            {manage && (
              <LinkForm action={a.inviteAction} hidden={{ clientId: c.id }} submit="Invite" shareLabel="Invitation created">
                <Field label="Email" name="email" type="email" required />
                <Field label="Name" name="name" />
                <fieldset><legend className="label">Access</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" name="roles" value="CLIENT" defaultChecked /> Client representative (approve quotes, sign off)</label>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" name="roles" value="REQUESTER" /> Requester (log and follow own requests)</label>
                </fieldset>
              </LinkForm>
            )}
          </Card>
          {manage && (
            <Card title="Edit customer">
              <Form action={a.updateClientAction} hidden={{ id: c.id }}>
                <Field label="Name" name="name" required defaultValue={c.name} />
                <Field label="Contact person" name="contactName" defaultValue={c.contactName} />
                <Field label="Email" name="email" type="email" defaultValue={c.email} />
                <Field label="Phone" name="phone" defaultValue={c.phone} />
                <TextArea label="Notes" name="notes" rows={2} defaultValue={c.notes} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" /> Archive this customer (history is kept)</label>
                <Submit>Save</Submit>
              </Form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
