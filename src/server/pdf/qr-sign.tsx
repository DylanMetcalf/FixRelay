/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> has no alt attribute */
import { Document, Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { notFound } from "@/lib/errors";
import { requirePerm, type Ctx } from "../permissions";
import { reportUrl } from "../qr";
import { getSite } from "../services/sites";
import { prisma } from "@/lib/db";
import { Mark } from "./brand";
import { C, registerFonts } from "./theme";

interface Sign { place: string; site: string; url: string; qr: string }

function SignPage({ sign, company }: { sign: Sign; company: string }) {
  const short = sign.url.replace(/^https?:\/\//, "");
  return (
    <Page size="A4" style={{ fontFamily: "Inter", padding: 40, color: C.ink }}>
      <View style={{ backgroundColor: C.navy, borderRadius: 8, padding: 22, alignItems: "center" }}>
        <Text style={{ color: C.amber, fontSize: 13, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>{company}</Text>
        <Text style={{ color: "#FFFFFF", fontSize: 30, fontWeight: 800, textAlign: "center", marginTop: 6 }}>Need to report a maintenance issue?</Text>
      </View>
      <View style={{ alignItems: "center", marginTop: 22 }}>
        <Text style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>{sign.site}</Text>
        <Text style={{ fontSize: 26, fontWeight: 800, textAlign: "center", marginTop: 2 }}>{sign.place}</Text>
        <View style={{ marginTop: 16, padding: 12, borderWidth: 3, borderColor: C.navy, borderRadius: 10 }}>
          <Image src={sign.qr} style={{ width: 250, height: 250 }} />
        </View>
        <Text style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>Scan with your phone camera</Text>
        <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>or type: {short}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>
        {[["1", "Scan the code", "The place is filled in for you."], ["2", "Say what is wrong", "Add a photo if you can."], ["3", "Send it", "You get a report number."]].map(([n, t, d]) => (
          <View key={n} style={{ flex: 1, backgroundColor: C.mist, borderRadius: 6, padding: 10 }}>
            <Text style={{ fontSize: 18, fontWeight: 800, color: C.amber }}>{n}</Text>
            <Text style={{ fontSize: 12, fontWeight: 800 }}>{t}</Text>
            <Text style={{ fontSize: 10, color: C.muted }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 16, borderLeftWidth: 4, borderLeftColor: "#B91C1C", backgroundColor: "#FEF2F2", padding: 10 }}>
        <Text style={{ fontSize: 10.5, fontWeight: 700, color: "#7F1D1D" }}>Urgent safety issue? Make the area safe and follow your site&apos;s emergency procedure first. This code does not replace it.</Text>
      </View>
      <View style={{ position: "absolute", left: 40, right: 40, bottom: 26, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
        <Mark size={16} />
        <Text style={{ fontSize: 9, color: C.muted, marginLeft: 6 }}>ManOp · From reported to resolved. No account or app needed.</Text>
      </View>
    </Page>
  );
}

const qrPng = (url: string) => QRCode.toDataURL(url, { margin: 1, width: 900, errorCorrectionLevel: "M", color: { dark: "#0B1F3A", light: "#FFFFFF" } });

/** A4 signs with a QR code: one for the site and one per area (or a single area with `locationId`). */
export async function renderQrSigns(ctx: Ctx, siteId: string, opts: { locationId?: string | null; siteOnly?: boolean } = {}) {
  requirePerm(ctx, "sites.manage");
  registerFonts();
  const site = await getSite(ctx, siteId);
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const places: { place: string; code: string }[] = [];
  if (opts.locationId) {
    const loc = site.locations.find((l) => l.id === opts.locationId);
    if (!loc?.publicCode) throw notFound("Area not found.");
    places.push({ place: loc.name, code: loc.publicCode });
  } else {
    places.push({ place: "Anywhere on this site", code: site.publicCode ?? site.publicToken });
    if (!opts.siteOnly) for (const l of site.locations) if (l.publicCode) places.push({ place: l.name, code: l.publicCode });
  }
  const signs: Sign[] = await Promise.all(places.map(async (p) => ({ place: p.place, site: site.name, url: reportUrl(p.code), qr: await qrPng(reportUrl(p.code)) })));
  const bytes = await renderToBuffer(
    <Document title={`QR signs – ${site.name}`} author="ManOp" creator="ManOp" producer="ManOp">
      {signs.map((sg) => <SignPage key={sg.url} sign={sg} company={org.name} />)}
    </Document>,
  );
  const safe = site.name.replace(/[^\w-]+/g, "_").slice(0, 40);
  return { bytes, filename: `MANOP_QR_Signs_${safe}.pdf` };
}
