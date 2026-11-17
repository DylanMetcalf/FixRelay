import { notFound } from "next/navigation";
import * as a from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { ActionButton, Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, Empty, Field, JobList, PageHeader, Pill } from "@/components/ui";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can } from "@/server/permissions";
import { reportUrl } from "@/server/qr";
import { listJobs } from "@/server/services/jobs";
import { getSite } from "@/server/services/sites";

export const metadata = { title: "Site" };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePage("sites.view");
  const { id } = await params;
  const s = await getSite(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const [jobs, org] = await Promise.all([listJobs(ctx, { siteId: s.id }, 15), prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { publicReportingEnabled: true } })]);
  const manage = can(ctx, "sites.manage");
  return (
    <>
      <PageHeader title={s.name} subtitle={s.address}>
        <Link href={`/requests/new?site=${s.id}`} className="btn btn-primary">+ Report a fault</Link>
        {manage && <Link href={`/sites/${s.id}/qr`} className="btn btn-secondary">Print QR codes</Link>}
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Locations">
            {s.locations.length === 0 ? <p className="muted">No locations yet. Add areas such as “Cold Room 2” or “Main Kitchen” so faults can be pinpointed.</p> : (
              <div className="flex flex-wrap gap-2">{s.locations.map((l) => <Pill key={l.id}>{l.name} · {l._count.jobs}</Pill>)}</div>
            )}
            {manage && (
              <Form action={a.createLocationAction} hidden={{ siteId: s.id }} className="mt-3 flex flex-wrap items-end gap-2">
                <input name="name" aria-label={`New location at ${s.name}`} placeholder="Add a location, e.g. Plant room" className="input max-w-xs !min-h-10 text-sm" required />
                <Submit className="btn btn-secondary btn-sm">Add location</Submit>
              </Form>
            )}
          </Card>
          <Card title="Equipment" aside={<Link className="link text-sm" href="/assets">All equipment</Link>}>
            {s.assets.length === 0 ? <p className="muted">No equipment recorded. Add machines you want a repair history for.</p> : (
              <ul className="divide-y divide-gray-200 text-sm">
                {s.assets.map((x) => <li key={x.id} className="flex justify-between py-2"><Link className="link" href={`/assets/${x.id}`}>{x.reference} – {x.name}</Link><span className="text-gray-600">{x.location?.name ?? ""}</span></li>)}
              </ul>
            )}
          </Card>
          <div>
            <h2 className="mb-3 text-lg font-extrabold">Recent jobs</h2>
            <JobList jobs={jobs} empty={<Empty title="No faults reported at this site yet" />} />
          </div>
        </div>
        <div className="space-y-5">
          <Card title="Report link and QR codes">
            <p className="muted mb-2">Stick QR codes on machines and doors. Scanning one opens the fault form with the place already filled in.</p>
            <p className="text-sm">Reporting without an account is <strong>{org.publicReportingEnabled ? "on" : "off"}</strong>{can(ctx, "org.manage") && <> (<Link className="link" href="/settings">change</Link>)</>}. {org.publicReportingEnabled ? "Anyone with the link can report a fault; reports are marked for screening." : "People must sign in before reporting."}</p>
            <input readOnly value={reportUrl(s.publicToken)} aria-label="Site report link" className="input mt-2 font-mono text-xs" data-testid="site-report-link" />
            {manage && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/sites/${s.id}/qr`} className="btn btn-secondary btn-sm">Print QR labels</Link>
                <ActionButton action={a.rotateSiteLinkAction} hidden={{ id: s.id }} className="btn btn-secondary btn-sm" confirm="Replace the link? All printed QR codes for this site will stop working.">Replace link</ActionButton>
              </div>
            )}
          </Card>
          {manage && (
            <Card title="Add equipment">
              <Form action={a.createAssetAction} hidden={{ siteId: s.id }}>
                {s.locations.length > 0 && (
                  <div><label className="label" htmlFor="locationId">Location</label><select id="locationId" name="locationId" className="input"><option value="">—</option>{s.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
                )}
                <Field label="Reference" name="reference" required placeholder="e.g. CMP-002" />
                <Field label="Name" name="name" required />
                <Field label="Make / model" name="model" />
                <Field label="Serial number" name="serialNumber" />
                <Submit>Add equipment</Submit>
              </Form>
            </Card>
          )}
          {manage && (
            <Card title="Edit site">
              <Form action={a.updateSiteAction} hidden={{ id: s.id }}>
                <Field label="Name" name="name" required defaultValue={s.name} />
                <Field label="Address" name="address" defaultValue={s.address} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" /> Archive this site (history is kept)</label>
                <Submit>Save</Submit>
              </Form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
