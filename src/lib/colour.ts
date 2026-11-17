/** Black or white text, whichever contrasts better with the tenant's brand colour (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#111827" {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? "#111827" : "#ffffff";
}
export const safeColour = (hex: string | undefined | null) => (hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#1e5aa8");
