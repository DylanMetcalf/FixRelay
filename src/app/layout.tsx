import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/client";
import { Flash } from "@/components/form";
import { appUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl() || "http://localhost:3000"),
  title: { default: "Resultra", template: "%s · Resultra" },
  description: "From reported to resolved. Maintenance requests, job cards and approvals in one place.",
  applicationName: "Resultra",
  manifest: "/api/manifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon-32.png", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Resultra", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: { title: "Resultra – From reported to resolved.", description: "Maintenance requests, job cards and approvals in one place.", images: ["/brand/og.png"], type: "website" },
  robots: { index: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0B1F3A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>
        {children}
        <Flash />
        <ServiceWorker />
      </body>
    </html>
  );
}
