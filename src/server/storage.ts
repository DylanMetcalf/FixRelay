/**
 * Private object storage behind a tiny interface. The default driver writes to STORAGE_DIR on local disk.
 * Files are never served statically: every read goes through an authorised route (see services/attachments.ts).
 * To move to S3-compatible storage, implement `Storage` and return it from `storage()` (see DEPLOYMENT.md).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Storage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }
  async put(key: string, bytes: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { flag: "wx" });
  }
  get(key: string) {
    return readFile(this.file(key));
  }
}

let instance: Storage | undefined;
export const storage = (): Storage => (instance ??= new LocalStorage(path.resolve(process.env.STORAGE_DIR ?? "./.storage")));
