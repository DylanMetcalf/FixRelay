/**
 * Shared look of every Resultra PDF: bundled Inter fonts (identical output on every server), brand colours from
 * BRAND.md, A4 page with consistent margins, and South African date formatting in the company's time zone.
 */
import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let registered = false;
export function registerFonts() {
  if (registered) return;
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(FONT_DIR, "Inter-Regular.otf") },
      { src: path.join(FONT_DIR, "Inter-Italic.otf"), fontStyle: "italic" },
      { src: path.join(FONT_DIR, "Inter-SemiBold.otf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "Inter-Bold.otf"), fontWeight: 700 },
      { src: path.join(FONT_DIR, "Inter-ExtraBold.otf"), fontWeight: 800 },
    ],
  });
  // Keep long words (references, part numbers) intact instead of hyphenating them.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export const C = {
  navy: "#0B1F3A", navy2: "#132B4D", amber: "#F5A524", blue: "#1E5AA8", reportBlue: "#5B8DEF",
  mist: "#F3F5F8", ink: "#111827", muted: "#4B5563", line: "#D1D5DB", faint: "#E5E7EB", green: "#166534", red: "#991B1B",
};

export const TZ = "Africa/Johannesburg";
export const fmtDT = (d: Date | null | undefined) =>
  d ? `${d.toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })} SAST` : "—";
export const fmtD = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }) : "—");

export const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9.5, color: C.ink, paddingTop: 36, paddingBottom: 64, paddingHorizontal: 36 }, // no lineHeight here: it stops react-pdf drawing the fixed footer
  h2: { fontSize: 11, fontWeight: 800, color: C.navy, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  section: { marginTop: 14 },
  rule: { borderBottomWidth: 2, borderBottomColor: C.amber, width: 28, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderLeftWidth: 1, borderColor: C.line },
  cell: { width: "50%", borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 4, paddingHorizontal: 6 },
  cellWide: { width: "100%", borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 5, paddingHorizontal: 6 },
  label: { fontSize: 7, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  value: { fontSize: 9.5, marginTop: 1, lineHeight: 1.15 },
  body: { lineHeight: 1.2 }, // Inter already carries a generous line gap
  box: { borderWidth: 1, borderColor: C.line, borderRadius: 3, padding: 8 },
  muted: { color: C.muted },
  small: { fontSize: 8 },
  bold: { fontWeight: 700 },
  table: { borderTopWidth: 1, borderColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: C.faint, paddingVertical: 3 },
  th: { fontSize: 7, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
});
