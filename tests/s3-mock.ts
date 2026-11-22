import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crc32 } from "node:zlib";

/**
 * Minimal in-process S3 stand-in for testing the S3 storage driver (replaces the unmaintained `s3rver`).
 * Implements path-style PutObject / GetObject for configured buckets and, unlike a plain stub, checks what a
 * real S3 service checks on those calls: the AWS Signature Version 4 header (against the configured key pair),
 * the signed payload SHA-256 and any CRC32 checksum header. Objects live in memory; nothing touches disk.
 */
export interface MockObject { body: Buffer; contentType?: string; sse?: string }

export interface MockS3 {
  endpoint: string;
  objects: Map<string, MockObject>;
  requests: { method: string; path: string; status: number }[];
  close(): Promise<void>;
}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function xmlError(res: http.ServerResponse, status: number, code: string, message: string) {
  res.writeHead(status, { "content-type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`);
}

/** Returns an error code, or null if the request carries a valid SigV4 signature for `body`. */
function verifySigV4(req: http.IncomingMessage, url: URL, body: Buffer, accessKeyId: string, secret: string): string | null {
  const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(req.headers.authorization ?? "");
  if (!auth) return "AccessDenied";
  const [, akid, date, region, signedHeaders, signature] = auth as unknown as [string, string, string, string, string, string];
  if (akid !== accessKeyId) return "InvalidAccessKeyId";
  const amzDate = String(req.headers["x-amz-date"] ?? "");
  if (!amzDate.startsWith(date)) return "AccessDenied";
  const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
  if (payloadHash !== "UNSIGNED-PAYLOAD" && payloadHash !== sha256(body)) return "XAmzContentSHA256Mismatch";
  const names = signedHeaders.split(";");
  if (!names.includes("host") || !names.includes("x-amz-date")) return "AccessDenied";
  const canonicalHeaders = names.map((h) => `${h}:${String(req.headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const query = [...url.searchParams].map(([k, v]): [string, string] => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [req.method, url.pathname, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
  const expected = hmac(key, toSign);
  return timingSafeEqual(expected, Buffer.from(signature, "hex")) ? null : "SignatureDoesNotMatch";
}

export async function startMockS3(opts: { buckets: string[]; accessKeyId: string; secretAccessKey: string }): Promise<MockS3> {
  const objects = new Map<string, MockObject>();
  const requests: MockS3["requests"] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://localhost");
    res.on("finish", () => requests.push({ method: req.method ?? "", path: url.pathname, status: res.statusCode }));

    const sigError = verifySigV4(req, url, body, opts.accessKeyId, opts.secretAccessKey);
    if (sigError) return xmlError(res, 403, sigError, "Request signature rejected");
    const [, bucket = "", ...rest] = url.pathname.split("/");
    const key = decodeURIComponent(rest.join("/"));
    if (!opts.buckets.includes(bucket)) return xmlError(res, 404, "NoSuchBucket", "The specified bucket does not exist");
    if (!key) return xmlError(res, 501, "NotImplemented", "Only object operations are supported");
    const id = `${bucket}/${key}`;

    if (req.method === "PUT") {
      if (["uploads", "uploadId", "partNumber"].some((q) => url.searchParams.has(q))) return xmlError(res, 501, "NotImplemented", "Only single-part PutObject is supported");
      const crc = req.headers["x-amz-checksum-crc32"];
      if (crc) {
        const actual = Buffer.alloc(4);
        actual.writeUInt32BE(crc32(body));
        if (actual.toString("base64") !== crc) return xmlError(res, 400, "BadDigest", "CRC32 checksum mismatch");
      }
      objects.set(id, { body, contentType: req.headers["content-type"], sse: req.headers["x-amz-server-side-encryption"] as string | undefined });
      res.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"` });
      return res.end();
    }
    if (req.method === "GET") {
      const obj = objects.get(id);
      if (!obj) return xmlError(res, 404, "NoSuchKey", "The specified key does not exist.");
      res.writeHead(200, { "content-type": obj.contentType ?? "application/octet-stream", "content-length": obj.body.length });
      return res.end(obj.body);
    }
    return xmlError(res, 405, "MethodNotAllowed", "Method not allowed");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
