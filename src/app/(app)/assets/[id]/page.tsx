import Link from "@/components/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/app/_lib/session";
import { Card, Empty, fmtDate, PageHeader, StatusBadge } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { getAsset } from "@/server/services/clients";

export const metadata = { title: "Asset" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePage("clients.view");
  const x = await getAsset(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const rows = [["Type", x.type], ["Manufacturer", x.manufacturer], ["Model", x.model], ["Serial number", x.serialNumber], ["Site", x.site.name], ["Location", x.location?.name ?? ""], ["Notes", x.notes]].filter(([, v]) => v);
  return (
    <>
      <PageHeader title={`${x.reference} – ${x.name}`} subtitle={<Link className="link" href={`/customers/${x.site.client.id}`}>{x.site.client.name}</Link>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Details" className="self-start">
          <dl className="space-y-2 text-sm">{rows.map(([k, v]) => <div key={k}><dt className="text-xs font-bold uppercase text-gray-600">{k}</dt><dd>{v}</dd></div>)}</dl>
        </Card>
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-extrabold">Maintenance history</h2>
          {x.jobs.length === 0 ? <Empty title="No maintenance recorded for this asset yet" /> : (
            <ul className="space-y-2">
              {x.jobs.map((j) => (
                <li key={j.id}><Link href={`/jobs/${j.id}`} className="card flex flex-wrap items-center justify-between gap-2 !p-3 hover:border-gray-500">
                  <span><span className="text-xs font-bold text-gray-600">{j.reference} · {fmtDate(j.reportedAt)}</span><span className="block font-semibold">{j.title}</span></span>
                  <StatusBadge status={j.status} />
                </Link></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
