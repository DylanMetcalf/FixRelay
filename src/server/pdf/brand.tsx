/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> has no alt attribute */
import { Circle, Image, Link, Path, Rect, Svg, Text, View } from "@react-pdf/renderer";
import { C, fmtDT, s } from "./theme";

/** The ManOp mark (same geometry as public/brand/manop-mark.svg). */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Rect width="512" height="512" rx="112" fill={C.navy} />
      <Path d="M140 372V150l70 96" fill="none" stroke="#FFFFFF" strokeWidth={46} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M210 246l52 70 110-176" fill="none" stroke={C.amber} strokeWidth={46} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M372 140v232" fill="none" stroke="#FFFFFF" strokeWidth={46} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="140" cy="372" r="25" fill={C.reportBlue} />
    </Svg>
  );
}

export interface HeaderInfo {
  title: string;
  number: string;
  numberLabel: string;
  status: string;
  company: { name: string; address: string; phone: string };
  site: { name: string; address: string };
  generatedAt: Date;
}

/** Document header: ManOp brand, document title and number, the customer's company and site, status. */
export function DocHeader({ h }: { h: HeaderInfo }) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.navy, borderRadius: 4, padding: 12 }}>
        <Mark size={30} />
        <View style={{ marginLeft: 10, flexGrow: 1 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: 800, letterSpacing: 0.4 }}>{h.title}</Text>
          <Text style={{ color: "#CBD5E1", fontSize: 8, marginTop: 2 }}>ManOp · From reported to resolved.</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: "#CBD5E1", fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{h.numberLabel}</Text>
          <Text style={{ color: C.amber, fontSize: 16, fontWeight: 800 }}>{h.number}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", marginTop: 10, gap: 10 }}>
        <View style={{ flex: 1.3 }}>
          <Text style={s.label}>Company</Text>
          <Text style={{ fontSize: 12, fontWeight: 800 }}>{h.company.name}</Text>
          {(h.company.address || h.company.phone) && <Text style={[s.small, s.muted]}>{[h.company.address, h.company.phone].filter(Boolean).join(" · ")}</Text>}
        </View>
        <View style={{ flex: 1.3 }}>
          <Text style={s.label}>Site</Text>
          <Text style={{ fontSize: 11, fontWeight: 700 }}>{h.site.name}</Text>
          {h.site.address && <Text style={[s.small, s.muted]}>{h.site.address}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Status when generated</Text>
          <Text style={{ fontSize: 10, fontWeight: 800, color: C.blue }}>{h.status}</Text>
          <Text style={[s.small, s.muted]}>Generated {fmtDT(h.generatedAt)}</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Fixed footer on every page: brand, reference, page x of y, generation time, and an optional QR code that opens
 * the digital record. The QR code only links to the job page, which still requires signing in with access to it.
 */
export function DocFooter({ reference, generatedAt, qr, href, note }: { reference: string; generatedAt: Date; qr?: string; href?: string; note?: string }) {
  return (
    <View fixed style={{ position: "absolute", left: 36, right: 36, bottom: 18, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: C.line, paddingTop: 6 }}>
      <Mark size={14} />
      <View style={{ marginLeft: 6, flexGrow: 1 }}>
        <Text style={{ fontSize: 7.5, fontWeight: 700, color: C.navy }}>ManOp · {reference}</Text>
        <Text style={{ fontSize: 6.5, color: C.muted }}>{note ?? `Snapshot generated ${fmtDT(generatedAt)}. The live record may have changed since.`}</Text>
      </View>
      <Text style={{ fontSize: 7.5, color: C.muted, marginRight: qr ? 8 : 0 }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      {qr && (
        // Also a clickable link in the digital PDF. It opens the job page, which still requires signing in.
        <Link src={href ?? ""} style={{ alignItems: "center" }}>
          <Image src={qr} style={{ width: 34, height: 34 }} />
        </Link>
      )}
    </View>
  );
}

export function Section({ title, children, wrap = true, minPresenceAhead = 80 }: { title: string; children: React.ReactNode; wrap?: boolean; minPresenceAhead?: number }) {
  return (
    <View style={s.section} wrap={wrap}>
      <View minPresenceAhead={minPresenceAhead}>
        <Text style={s.h2}>{title}</Text>
        <View style={s.rule} />
      </View>
      {children}
    </View>
  );
}

/** Two-column label/value grid. `wide` items span both columns. Empty values show an em dash. */
export function Fields({ items }: { items: { label: string; value: string | null | undefined; wide?: boolean }[] }) {
  return (
    <View style={s.grid}>
      {items.map((it) => (
        <View key={it.label} style={it.wide ? s.cellWide : s.cell} wrap={false}>
          <Text style={s.label}>{it.label}</Text>
          <Text style={s.value}>{it.value?.trim() ? it.value : "—"}</Text>
        </View>
      ))}
    </View>
  );
}
