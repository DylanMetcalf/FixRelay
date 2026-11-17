import { createSiteAction } from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, Empty, Field, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";
import { listSites } from "@/server/services/sites";

export const metadata = { title: "Sites" };

export default async function Sites() {
  const { ctx } = await requirePage("sites.view");
  const sites = await listSites(ctx);
  return (
    <>
      <PageHeader title="Sites" subtitle="Your sites, their locations and equipment. Each site has its own report link and QR codes." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {sites.length === 0 ? <Empty title="No sites yet">Add your first site to start logging faults.</Empty> : (
            <ul className="space-y-2">
              {sites.map((s) => (
                <li key={s.id}><Link href={`/sites/${s.id}`} className="card flex items-center justify-between gap-3 !p-4 hover:border-gray-500">
                  <span><span className="block font-bold text-gray-900">{s.name}</span><span className="muted">{s.address || "No address"}</span></span>
                  <span className="text-right text-xs font-semibold text-gray-600">{s._count.locations} location{s._count.locations === 1 ? "" : "s"} · {s._count.assets} equipment<br />{s._count.jobs} job{s._count.jobs === 1 ? "" : "s"}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </div>
        {can(ctx, "sites.manage") && (
          <Card title="Add a site" className="self-start">
            <Form action={createSiteAction}>
              <Field label="Site name" name="name" required placeholder="e.g. Germiston Plant" />
              <Field label="Address" name="address" />
              <Submit>Add site</Submit>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
