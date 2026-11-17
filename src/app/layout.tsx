import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/client";
import { Flash } from "@/components/form";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "FixRelay", template: "%s · FixRelay" },
  description: "From fault reported to job completed. Every request, quote, approval and repair in one place.",
  applicationName: "FixRelay",
  manifest: "/api/manifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon-32.png", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "FixRelay", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: { title: "FixRelay", description: "Maintenance jobs from fault to sign-off, in one simple app.", images: ["/brand/og.png"], type: "website" },
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
