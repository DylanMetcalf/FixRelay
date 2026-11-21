/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> has no alt attribute */
import { Image, Text, View } from "@react-pdf/renderer";
import type { Photo } from "./data";
import { C, fmtDT, s } from "./theme";

const CONTENT_W = 595.28 - 72;

/** Photos in a two-column grid. Each image keeps its aspect ratio inside a fixed box (no stretching or cropping). */
export function PhotoGrid({ photos, more, empty, boxH = 170 }: { photos: Photo[]; more: number; empty: string; boxH?: number }) {
  if (photos.length === 0) return <View style={[s.box, { backgroundColor: C.mist, alignItems: "center", padding: 14 }]}><Text style={s.muted}>{empty}</Text></View>;
  const boxW = (CONTENT_W - 10) / 2;
  const rows: Photo[][] = [];
  for (let i = 0; i < photos.length; i += 2) rows.push(photos.slice(i, i + 2));
  return (
    <View>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", gap: 10, marginBottom: 8 }} wrap={false}>
          {row.map((p) => {
            let w = boxW - 8;
            let h = (w * p.height) / p.width;
            if (h > boxH - 8) { h = boxH - 8; w = (h * p.width) / p.height; }
            return (
              <View key={p.id} style={{ width: boxW }}>
                <View style={{ height: boxH, backgroundColor: C.mist, borderWidth: 1, borderColor: C.line, borderRadius: 3, alignItems: "center", justifyContent: "center" }}>
                  <Image src={p.data} style={{ width: w, height: h }} />
                </View>
                <Text style={[s.small, s.muted, { marginTop: 2 }]}>{p.caption}</Text>
              </View>
            );
          })}
        </View>
      ))}
      {more > 0 && <Text style={[s.small, s.muted]}>+ {more} more photo{more === 1 ? "" : "s"} in the digital record.</Text>}
    </View>
  );
}

/** A writing area for the printed card: label and ruled lines. */
export function WriteBox({ label, lines = 3, grow }: { label: string; lines?: number; grow?: number }) {
  // `grow` only inside a row: in a column, flex would collapse the ruled lines to nothing.
  return (
    <View style={grow ? { flexGrow: grow, flexBasis: 0, marginBottom: 8 } : { marginBottom: 8 }}>
      <Text style={s.label}>{label}</Text>
      {Array.from({ length: lines }, (_, i) => <View key={i} style={{ borderBottomWidth: 1, borderColor: C.line, height: 20 }} />)}
    </View>
  );
}

/** A recorded signature (image, name, time) or an explicit "not signed" line. A blank line never implies approval. */
export function SignatureBlock({ label, sig }: { label: string; sig?: { name: string; signedAt: Date; image: Buffer | null } }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 3, padding: 6, minHeight: 70 }} wrap={false}>
      <Text style={s.label}>{label}</Text>
      {sig ? (
        <>
          {sig.image && <Image src={sig.image} style={{ height: 34, objectFit: "contain", marginTop: 2 }} />}
          <Text style={{ fontSize: 9, fontWeight: 700 }}>{sig.name}</Text>
          <Text style={[s.small, s.muted]}>Signed {fmtDT(sig.signedAt)}</Text>
        </>
      ) : <Text style={[s.small, s.muted, { marginTop: 6 }]}>No signature recorded.</Text>}
    </View>
  );
}

export function Para({ label, text }: { label: string; text: string | null | undefined }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{text?.trim() ? text : "—"}</Text>
    </View>
  );
}
