import QRCode from "qrcode";
import { appUrl } from "@/lib/app-url";

/** Short report link for a site, area or machine: /r/{publicCode}. The code says where; no database ids. */
export const reportUrl = (publicCode: string) => `${appUrl() || "http://localhost:3000"}/r/${publicCode}`;

/** Crisp, scalable QR code as inline SVG (medium error correction survives scuffed stickers). */
export const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0B1F3A", light: "#FFFFFF" } });
