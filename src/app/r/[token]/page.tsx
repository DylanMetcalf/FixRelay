import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { PublicMessage, PublicShell } from "@/components/public-shell";
import { Card } from "@/components/ui";
import { QuickReport } from "@/components/quick-report";
import { prisma } from "@/lib/db";

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
  const site = /^[A-Za-z0-9_-]{16,64}$/.test(token)
    ? await prisma.site.findUnique({ where: { publicToken: token }, include: {
        locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        assets: { select: { id: true, name: true, reference: true, locationId: true }, orderBy: { name: "asc" } } } })
    : null;
  if (!site || site.archived) return <PublicMessage title="This report link is not active">Please contact the site&apos;s maintenance team. The QR code may have been replaced.</PublicMessage>;
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: site.orgId } });
  const valid = (id: string | undefined, list: { id: string }[]) => (id && list.some((x) => x.id === id) ? id : undefined);
  const locationId = valid(sp.l, site.locations);
  const assetId = valid(sp.a, site.assets);
  const prefill = new URLSearchParams({ site: site.id, ...(locationId ? { location: locationId } : {}), ...(assetId ? { asset: assetId } : {}) }).toString();
  const s = await getSession();
  if (s?.ctx && s.ctx.orgId === site.orgId) redirect(`/requests/new?${prefill}`);
  if (!org.publicReportingEnabled) redirect(`/login?next=${encodeURIComponent(`/requests/new?${prefill}`)}`);
  const asset = site.assets.find((a) => a.id === assetId);
  return (
    <PublicShell org={org}>
      <div className="mx-auto max-w-md space-y-4">
        <div className="px-1">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-600">{site.name}</p>
          <h1 className="text-3xl font-extrabold">Report a problem</h1>
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-base text-amber-950">If someone is hurt or in danger, call your supervisor first.</p>
        </div>
        <Card>
          <QuickReport token={token} siteName={site.name} locations={site.locations} initialLocationId={locationId}
            asset={asset ? { id: asset.id, label: `${asset.reference} – ${asset.name}` } : null} requireSignatures={org.requireSignatures} />
        </Card>
      </div>
    </PublicShell>
  );
}
