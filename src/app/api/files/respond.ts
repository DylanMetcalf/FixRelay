import { NextResponse } from "next/server";

/** Serve a stored file defensively: fixed sniffed type, no sniffing, sandboxed, never cached by shared caches. */
export function fileResponse(f: { bytes: Buffer; mimeType: string; filename: string }) {
  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(f.bytes.length),
      "Content-Disposition": `inline; filename="${f.filename.replace(/[^\w.\- ]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
