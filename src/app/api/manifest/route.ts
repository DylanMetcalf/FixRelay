import { NextResponse } from "next/server";
import { getSession } from "@/app/_lib/session";

/**
 * Web app manifest. The app is always "FixRelay"; when signed in, the installed name also carries the company
 * name. start_url, id and scope never vary by tenant, and the response is not cached, so branding cannot leak
 * between companies.
 */
export async function GET() {
  const s = await getSession();
  const org = s?.org;
  return NextResponse.json(
    {
      id: "/",
      name: org ? `FixRelay – ${org.name}` : "FixRelay",
      short_name: "FixRelay",
      description: "From fault reported to job completed. Maintenance requests, quotes, approvals and jobs in one place.",
      start_url: "/dashboard?source=pwa", scope: "/", display: "standalone", display_override: ["standalone", "minimal-ui"],
      orientation: "any", background_color: "#0B1F3A", theme_color: "#0B1F3A", lang: "en-ZA", dir: "ltr",
      categories: ["business", "productivity", "utilities"],
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      ],
      shortcuts: [
        { name: "Report a fault", short_name: "Report", url: "/requests/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        { name: "My jobs", url: "/my-jobs", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        { name: "Dashboard", url: "/dashboard", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      ],
      screenshots: [
        { src: "/screenshots/phone-job.png", sizes: "780x1688", type: "image/png", form_factor: "narrow", label: "A job on a technician's phone" },
        { src: "/screenshots/desktop-dashboard.png", sizes: "1280x800", type: "image/png", form_factor: "wide", label: "Manager dashboard" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, no-store" } },
  );
}
