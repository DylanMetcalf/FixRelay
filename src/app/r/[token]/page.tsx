import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { PublicMessage, PublicShell } from "@/components/public-shell";
import { Card } from "@/components/ui";
import { QuickReport } from "@/components/quick-report";
import { prisma } from "@/lib/db";
import { resolvePublicCode } from "@/server/services/sites";

export const metadata = { title: "Report a fault", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where QR codes and site links point. Members of the organisation who are signed in go to the full request form
 * (pre-filled). Everyone else gets the no-account form if the organisation allows public reporting, otherwise
 * they are asked to sign in.
 */
export default async function SiteReport({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ l?: string; a?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const found = await resolvePublicCode(token, sp);
  const site = found ? await prisma.site.findUnique({ where: { id: found.site.id }, include: {
    locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    assets: { select: { id: true, name: true, reference: true, locationId: true }, orderBy: { name: "asc" } } } }) : null;
  if (!found || !site || site.archived) return <PublicMessage title="This report link is not active">Please contact the site&apos;s maintenance team. The QR code may have been replaced.</PublicMessage>;
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: site.orgId } });
  if (org.archivedAt) return <PublicMessage title="This report link is not active">Please contact the site&apos;s maintenance team.</PublicMessage>;
  const locationId = found.locationId ?? undefined;
  const assetId = found.assetId ?? undefined;
  const prefill = new URLSearchParams({ site: site.id, ...(locationId ? { location: locationId } : {}), ...(assetId ? { asset: assetId } : {}) }).toString();
  const s = await getSession();
  if (s?.ctx && s.ctx.orgId === site.orgId) redirect(`/requests/new?${prefill}`);
  if (!org.publicReportingEnabled) redirect(`/login?next=${encodeURIComponent(`/requests/new?${prefill}`)}`);
  const asset = site.assets.find((a) => a.id === assetId);
  const place = site.locations.find((l) => l.id === locationId);
  return (
    <PublicShell org={org}>
      <div className="mx-auto max-w-md space-y-4">
        <div className="px-1">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-600" data-testid="report-site">{site.name}{place ? ` · ${place.name}` : ""}</p>
          <h1 className="text-3xl font-extrabold">Report a problem</h1>
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-base text-amber-950" role="note"><strong>Urgent safety issue?</strong> Make the area safe and follow your site&apos;s emergency procedure first (for example, tell your supervisor). This form does not replace it.</p>
        </div>
        <Card>
          <QuickReport token={token} siteName={site.name} locations={site.locations} initialLocationId={locationId}
            asset={asset ? { id: asset.id, label: `${asset.reference} – ${asset.name}` } : null} requireSignatures={org.requireSignatures} />
        </Card>
      </div>
    </PublicShell>
  );
}
