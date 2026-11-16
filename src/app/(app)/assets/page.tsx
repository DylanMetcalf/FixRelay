import Link from "@/components/link";
import { createAssetAction } from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Card, Empty, Field, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";
import { listAssets, requestFormOptions } from "@/server/services/clients";

export const metadata = { title: "Assets" };

export default async function Assets({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { ctx } = await requirePage("clients.view");
  const { q } = await searchParams;
  const [assets, clients] = await Promise.all([listAssets(ctx, q), can(ctx, "clients.manage") ? requestFormOptions(ctx) : []]);
  const sites = clients.flatMap((c) => c.sites.map((s) => ({ id: s.id, label: `${c.name} – ${s.name}` })));
  return (
    <>
      <PageHeader title="Assets" subtitle="Equipment you maintain, with its repair history. Optional: jobs do not need an asset." />
      <form method="get" className="no-print mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="Search name, reference or serial number" aria-label="Search assets" className="input max-w-md" /><button className="btn btn-secondary">Search</button></form>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {assets.length === 0 ? <Empty title={q ? "No assets match your search" : "No assets yet"}>Add equipment to keep a service history against it.</Empty> : (
            <ul className="space-y-2">
              {assets.map((x) => (
                <li key={x.id}><Link href={`/assets/${x.id}`} className="card flex items-center justify-between gap-3 !p-4 hover:border-gray-500">
                  <span><span className="block font-bold">{x.reference} – {x.name}</span><span className="muted">{x.site.client.name} · {x.site.name}{x.location && ` · ${x.location.name}`}</span></span>
                  <span className="text-xs font-semibold text-gray-600">{x._count.jobs} job{x._count.jobs === 1 ? "" : "s"}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </div>
        {can(ctx, "clients.manage") && sites.length > 0 && (
          <Card title="Add an asset" className="self-start">
            <Form action={createAssetAction}>
              <div><label className="label" htmlFor="siteId">Site</label><select id="siteId" name="siteId" className="input" required>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
              <Field label="Asset reference" name="reference" required placeholder="e.g. CMP-002" />
              <Field label="Name" name="name" required />
              <Field label="Type" name="type" />
              <Field label="Manufacturer" name="manufacturer" />
              <Field label="Model" name="model" />
              <Field label="Serial number" name="serialNumber" />
              <Submit>Add asset</Submit>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
