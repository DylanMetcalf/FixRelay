/**
 * Upload safety pipeline, applied to every file before it is stored:
 *  1. Built-in PDF check: PDFs containing active content (JavaScript, launch actions, embedded files,
 *     forms that run code, rich media) are refused. Ordinary scanned/test-report PDFs pass.
 *  2. ClamAV antivirus (when CLAMAV_HOST or CLAMAV_SOCKET is set) using clamd's INSTREAM protocol.
 *     If ClamAV is configured but cannot be reached, the upload FAILS CLOSED (it is refused, not let through).
 *  3. Images are decoded and re-encoded (sharp): this removes ALL metadata (EXIF incl. GPS location, camera
 *     serials, XMP), applies the camera rotation, caps size at 2560px and rejects malformed/bomb images.
 */
import net from "node:net";
import sharp from "sharp";
import { invalid } from "@/lib/errors";

export type ScanResult = { ok: true } | { ok: false; reason: string };

const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData|GoToR)\b/;

export function pdfActiveContent(bytes: Buffer): string | null {
  // Names can be hex-escaped in PDF (e.g. /J#61vaScript); normalise those before matching.
  const text = bytes.toString("latin1").replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const m = PDF_ACTIVE.exec(text);
  return m ? m[1]! : null;
}

/** Talks to clamd (TCP or unix socket). Resolves to the virus name, or null when clean. */
export function clamdScan(bytes: Buffer, opts: { host?: string; port?: number; socketPath?: string; timeoutMs?: number }): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const sock = opts.socketPath ? net.createConnection(opts.socketPath) : net.createConnection(opts.port ?? 3310, opts.host ?? "127.0.0.1");
    const chunks: Buffer[] = [];
    sock.setTimeout(opts.timeoutMs ?? 15_000, () => sock.destroy(new Error("ClamAV timed out")));
    sock.on("error", reject);
    sock.on("data", (c) => chunks.push(c));
    sock.on("end", () => {
      const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim(); // "stream: OK" | "stream: Eicar-Test-Signature FOUND"
      if (/:\s*OK$/.test(reply)) resolve(null);
      else if (/FOUND$/.test(reply)) resolve(reply.replace(/^.*?:\s*/, "").replace(/\s*FOUND$/, ""));
      else reject(new Error(`Unexpected ClamAV reply: ${reply.slice(0, 120)}`));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 64 * 1024) {
        const part = bytes.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
  });
}

export async function scanFile(bytes: Buffer, mimeType: string, env: NodeJS.ProcessEnv = process.env): Promise<ScanResult> {
  if (mimeType === "application/pdf") {
    const active = pdfActiveContent(bytes);
    if (active) return { ok: false, reason: `This PDF contains active content (${active}) and was refused for safety. Please upload a flattened or printed-to-PDF copy.` };
  }
  if (env.CLAMAV_HOST || env.CLAMAV_SOCKET) {
    let virus: string | null;
    try {
      virus = await clamdScan(bytes, { host: env.CLAMAV_HOST, port: Number(env.CLAMAV_PORT ?? 3310), socketPath: env.CLAMAV_SOCKET });
    } catch (e) {
      console.error("[scan] ClamAV unavailable", e instanceof Error ? e.message : e);
      return { ok: false, reason: "The file could not be virus-scanned right now. Please try again in a few minutes." };
    }
    if (virus) return { ok: false, reason: "This file was flagged by the virus scanner and was not uploaded." };
  }
  return { ok: true };
}

export const MAX_IMAGE_EDGE = 2560;

/** Re-encode an image without any metadata. Throws a user-facing error if it cannot be decoded safely. */
export async function sanitizeImage(bytes: Buffer, mimeType: string): Promise<Buffer> {
  try {
    const img = sharp(bytes, { limitInputPixels: 50_000_000, failOn: "error" })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true });
    // sharp drops all metadata unless withMetadata()/keepExif() is called; we never call them.
    if (mimeType === "image/png") return await img.png({ compressionLevel: 9 }).toBuffer();
    if (mimeType === "image/webp") return await img.webp({ quality: 82 }).toBuffer();
    return await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch {
    throw invalid("This image could not be read. Please take the photo again or upload a different file.");
  }
}
