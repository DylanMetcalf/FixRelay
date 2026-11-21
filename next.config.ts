import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Review links carry a secret in the URL: never send it to other sites as a referrer.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    // Scripts, data requests, images and fonts may only come from this site; nothing can frame us or post forms elsewhere.
    // 'unsafe-inline' is needed for Next.js's inline bootstrap scripts (a nonce-based policy is a roadmap item).
    value: [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "font-src 'self' data:", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "frame-ancestors 'none'",
      "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ].join("; "),
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  // Small build machines (e.g. the free 512 MB demo instance) run out of memory during Next's built-in lint and
  // type check. Those checks still run in development and CI (`npm run typecheck`, `npm run lint`, the test suites).
  ...(process.env.SKIP_BUILD_CHECKS === "1" ? { eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: true } } : {}),
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // The PDF engine loads fonts and its layout engine at runtime; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // Job documents may be shown inside Resultra's own job card viewer (same origin only).
      { source: "/api/jobs/:id/documents/:kind", headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'self'; object-src 'none'" },
      ] },
    ];
  },
};
export default config;
