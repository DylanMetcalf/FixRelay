import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";
import { safeColour } from "@/lib/colour";

/**
 * Web app manifest. When signed in, it carries the company's display name and brand colour, so an installed
 * app shows the tenant's branding. start_url and scope never vary by tenant, and the manifest is not cached,
 * so one tenant's branding cannot be served to another.
 */
export async function GET() {
  const s = await getSession();
  const org = s?.org;
  const pngLogo = org?.logoAttachmentId ? [{ src: `/api/files/${org.logoAttachmentId}`, sizes: "any", purpose: "any" }] : [];
  return NextResponse.json(
    {
      name: org ? `${org.name} – Maintenance` : "FixRelay",
      short_name: org ? org.name.slice(0, 12) : "FixRelay",
      description: "Maintenance requests, quotes, approvals and jobs.",
      start_url: "/dashboard", scope: "/", display: "standalone", orientation: "portrait",
      background_color: "#0f172a", theme_color: safeColour(org?.brandColour),
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ...pngLogo,
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, no-store" } },
  );
}
