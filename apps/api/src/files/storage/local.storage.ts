import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageProvider } from "./storage.interface";
import { Readable } from "stream";
import * as fs from "fs/promises";
import * as path from "path";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";

@Injectable()
export class LocalStorage implements StorageProvider {
  private readonly logger = new Logger(LocalStorage.name);
  private uploadDir: string;

  constructor(private config: ConfigService) {
    this.uploadDir = this.config.get("UPLOAD_DIR", "./uploads");
  }

  private getFilePath(key: string): string {
    const filePath = path.resolve(this.uploadDir, key);
    if (!filePath.startsWith(path.resolve(this.uploadDir))) {
      throw new Error("Path traversal detected");
    }
    return filePath;
  }

  /** Writes to a sibling `.part` file and renames it into place, so a failed stream never leaves a partial file at `key`. */
  async upload(key: string, body: Readable, size: number, _contentType: string): Promise<void> {
    const filePath = this.getFilePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const partPath = `${filePath}.${randomUUID()}.part`;
    try {
      await pipeline(body, createWriteStream(partPath));
      const written = (await fs.stat(partPath)).size;
      if (written !== size) {
        throw new Error(`Upload of ${key} was truncated: expected ${size} bytes, got ${written}`);
      }
      await fs.rename(partPath, filePath);
    } catch (err) {
      this.logger.warn(`Upload of ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
      body.destroy();
      await fs.rm(partPath, { force: true });
      throw err;
    }
  }

  async download(
    key: string,
  ): Promise<{ body: Readable; contentType: string }> {
    const filePath = this.getFilePath(key);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }
    const body = createReadStream(filePath);
    // Content type should be looked up from the DB, not filesystem
    return { body, contentType: "application/octet-stream" };
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    // Local storage doesn't support signed URLs; return a direct download path
    return `/api/files/download/${key}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  }
}
