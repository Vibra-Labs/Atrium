import { Readable } from "stream";

export interface StorageProvider {
  /**
   * Stream `body` (exactly `size` bytes) to `key`. Callers holding a Buffer
   * pass `Readable.from(buffer)`; large uploads pass a temp-file read stream.
   */
  upload(key: string, body: Readable, size: number, contentType: string): Promise<void>;
  download(key: string): Promise<{ body: Readable; contentType: string }>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export const STORAGE_PROVIDER = "STORAGE_PROVIDER";
