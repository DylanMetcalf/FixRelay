import QRCode from "qrcode";
import { appUrl } from "@/lib/app-url";

/** Report link encoded in a site's QR codes. Location/asset ids pre-fill the form. */
export const reportUrl = (siteToken: string, opts: { locationId?: string; assetId?: string } = {}) => {
  const q = new URLSearchParams({ ...(opts.locationId ? { l: opts.locationId } : {}), ...(opts.assetId ? { a: opts.assetId } : {}) }).toString();
  return `${appUrl() || "http://localhost:3000"}/r/${siteToken}${q ? `?${q}` : ""}`;
};

/** Crisp, scalable QR code as inline SVG (medium error correction survives scuffed stickers). */
export const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0B1F3A", light: "#FFFFFF" } });
