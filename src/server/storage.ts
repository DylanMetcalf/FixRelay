/**
 * Private object storage behind a two-method interface. Choose with STORAGE_DRIVER:
 *   db    (default) bytes in Postgres (StoredFile). Works with any number of app instances, and files are
 *                   included in database backups. Good up to a few GB; move to s3 beyond that.
 *   s3    any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Objects are private;
 *         the app streams them after its own permission checks, so no public or presigned URLs are needed.
 *   local a directory on this server (STORAGE_DIR). Single-instance / development only.
 * Files are never served statically: every read goes through an authorised route.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";

export interface Storage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const check = (key: string) => {
  if (!KEY.test(key)) throw new Error("Invalid storage key");
  return key;
};

class LocalStorage implements Storage {
  constructor(private root: string) {}
  async put(key: string, bytes: Buffer) {
    const f = path.join(this.root, check(key));
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { flag: "wx" });
  }
  get(key: string) {
    return readFile(path.join(this.root, check(key)));
  }
}

class DbStorage implements Storage {
  async put(key: string, bytes: Buffer) {
    await prisma.storedFile.create({ data: { key: check(key), bytes: new Uint8Array(bytes) } });
  }
  async get(key: string) {
    const f = await prisma.storedFile.findUnique({ where: { key: check(key) } });
    if (!f) throw new Error("File not found in storage");
    return Buffer.from(f.bytes);
  }
}

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(private bucket: string, cfg: { region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle?: boolean }) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
    });
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: check(key), Body: bytes, ContentType: contentType,
      ...(process.env.S3_SSE ? { ServerSideEncryption: process.env.S3_SSE as "AES256" } : {}),
    }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: check(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  switch (env.STORAGE_DRIVER ?? "db") {
    case "local":
      return new LocalStorage(path.resolve(env.STORAGE_DIR ?? "./.storage"));
    case "s3":
      if (!env.S3_BUCKET) throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET");
      return new S3Storage(env.S3_BUCKET, {
        region: env.S3_REGION ?? "auto", endpoint: env.S3_ENDPOINT, accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      });
    case "db":
      return new DbStorage();
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${env.STORAGE_DRIVER}"`);
  }
}

let instance: Storage | undefined;
export const storage = (): Storage => (instance ??= createStorage());
