import { notFound } from "next/navigation";
import { requirePage } from "@/app/_lib/session";
import Link from "@/components/link";
import { Mark } from "@/components/logo";
import { PrintButton } from "@/components/print";
import { AppError } from "@/lib/errors";
import { qrSvg, reportUrl } from "@/server/qr";
import { getSite } from "@/server/services/sites";

export const metadata = { title: "QR labels" };

/** Printable A4 sheet of QR labels: one for the site, one per location, one per piece of equipment. */
export default async function QrSheet({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePage("sites.manage");
  const s = await getSite(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const labels = [
    { title: s.name, sub: "Anywhere on this site", url: reportUrl(s.publicCode ?? s.publicToken) },
    ...s.locations.filter((l) => l.publicCode).map((l) => ({ title: l.name, sub: s.name, url: reportUrl(l.publicCode!) })),
    ...s.assets.filter((x) => x.publicCode).map((x) => ({ title: `${x.reference} – ${x.name}`, sub: `${s.name}${x.location ? ` · ${x.location.name}` : ""}`, url: reportUrl(x.publicCode!) })),
  ];
  const svgs = await Promise.all(labels.map((l) => qrSvg(l.url)));
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/sites/${s.id}`} className="btn btn-secondary">← Back to site</Link>
        <PrintButton />
        <a href={`/api/sites/${s.id}/signs`} className="btn btn-secondary" download>A4 signs for the site and every area (PDF)</a>
        <p className="muted">{labels.length} labels. Print on A4 sticker paper or plain paper and laminate.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2" data-testid="qr-labels">
        {labels.map((l, i) => (
          <figure key={l.url} className="break-inside-avoid rounded-lg border-2 border-navy bg-white p-3 text-center">
            <p className="text-xs font-extrabold uppercase tracking-wide text-navy">Scan to report a fault</p>
            <div className="mx-auto my-2 w-full max-w-[180px] [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svgs[i]! }} />
            <figcaption>
              <p className="text-sm font-extrabold leading-tight">{l.title}</p>
              <p className="text-xs text-gray-600">{l.sub}</p>
              <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-gray-700"><Mark size={12} /> ManOp · {l.url.replace(/^https?:\/\//, "")}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
