import { redirect } from "next/navigation";
import { SignLine } from "@/components/requisition-fields";
import { publicReportAction } from "@/app/actions/jobs";
import { getSession } from "@/app/_lib/session";
import { RequestPlaceFields } from "@/components/client-forms";
import { Form, Submit } from "@/components/form";
import { PublicMessage, PublicShell } from "@/components/public-shell";
import { Card, Field, TextArea } from "@/components/ui";
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
      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Report a fault · {site.name}</p>
        <h1 className="text-xl font-extrabold">{asset ? `Problem with ${asset.reference} – ${asset.name}?` : "What needs fixing?"}</h1>
        <p className="muted mt-1">Tell the maintenance team what is wrong. It takes a minute. If anyone is in danger, make the area safe and call your supervisor first.</p>
      </Card>
      <Card>
        <Form action={publicReportAction} hidden={{ siteToken: token }}>
          <Field label="What is the problem?" name="title" required maxLength={160} placeholder="e.g. Light not working in the passage" />
          <TextArea label="Describe it" name="description" required rows={3} placeholder="Where exactly, since when, is it getting worse?" />
          <RequestPlaceFields sites={[{ id: site.id, name: site.name, locations: site.locations, assets: site.assets }]} initial={{ siteId: site.id, locationId, assetId }} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Your name" name="reporterName" required autoComplete="name" />
            <Field label="Phone number" name="reporterPhone" required type="tel" autoComplete="tel" />
          </div>
          <Field label="Email (optional)" name="reporterEmail" type="email" autoComplete="email" hint="We will email you the reference number." />
          <SignLine label="Submitted by – your signature" required={org.requireSignatures} />
          <p className="text-xs text-gray-600">Your name and number are only used by the maintenance team to follow up on this report.</p>
          <Submit className="btn btn-primary w-full">Send report</Submit>
        </Form>
      </Card>
    </PublicShell>
  );
}
