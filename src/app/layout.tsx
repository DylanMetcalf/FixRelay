import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/client";
import { Flash } from "@/components/form";

export const metadata: Metadata = {
  title: { default: "FixRelay", template: "%s · FixRelay" },
  description: "From fault reported to job completed. Every request, quote, approval and repair in one place.",
  manifest: "/api/manifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  robots: { index: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f172a" };

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
