import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/client";
import { Flash } from "@/components/form";
import { appUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl() || "http://localhost:3000"),
  title: { default: "ManOp", template: "%s · ManOp" },
  description: "From reported to resolved. Maintenance operations: requests, job cards and approvals in one place.",
  applicationName: "ManOp",
  manifest: "/api/manifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon-32.png", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ManOp", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: { title: "ManOp – From reported to resolved.", description: "Maintenance operations: requests, job cards and approvals in one place.", images: ["/brand/og.png"], type: "website" },
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
