import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { LocalStorage } from "./local.storage";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { Readable } from "stream";
import { existsSync } from "fs";
import type { ConfigService } from "@nestjs/config";

describe("LocalStorage", () => {
  let storage: LocalStorage;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `atrium-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    const mockConfig = {
      get: (key: string, fallback?: string) => {
        if (key === "UPLOAD_DIR") return testDir;
        return fallback;
      },
    };
    storage = new LocalStorage(mockConfig as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("uploads and downloads a file", async () => {
    const content = Buffer.from("hello world");
    await storage.upload("test/file.txt", Readable.from(content), content.length, "text/plain");

    const result = await storage.download("test/file.txt");
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(chunk);
    }
    const downloaded = Buffer.concat(chunks).toString();
    expect(downloaded).toBe("hello world");
  });

  it("deletes a file", async () => {
    const content = Buffer.from("delete me");
    await storage.upload("to-delete.txt", Readable.from(content), content.length, "text/plain");
    await storage.delete("to-delete.txt");

    try {
      await storage.download("to-delete.txt");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  it("getSignedUrl returns local path", async () => {
    const url = await storage.getSignedUrl("some-key");
    expect(url).toContain("some-key");
  });

  it("handles nested directories on upload", async () => {
    const content = Buffer.from("nested");
    await storage.upload("a/b/c/file.txt", Readable.from(content), content.length, "text/plain");

    const result = await storage.download("a/b/c/file.txt");
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe("nested");
  });

  it("streams a multi-chunk body to disk", async () => {
    const chunks: Buffer[] = Array.from({ length: 50 }, (_, i) => Buffer.alloc(64 * 1024, i));
    const size = chunks.reduce((n, c) => n + c.length, 0);
    await storage.upload("big/file.bin", Readable.from(chunks), size, "application/octet-stream");
    const stat = await fs.stat(path.join(testDir, "big/file.bin"));
    expect(stat.size).toBe(size);
    expect(await fs.readdir(path.join(testDir, "big"))).toEqual(["file.bin"]);
  });

  it("leaves no file (final or partial) when the source stream fails", async () => {
    const body = new Readable({ read(): void {} });
    body.push(Buffer.alloc(1024, 1));
    setTimeout(() => body.destroy(new Error("source died")), 10);

    const err = await storage.upload("broken/file.bin", body, 4096, "application/octet-stream").catch((e: Error) => e);

    expect((err as Error).message).toBe("source died");
    expect(existsSync(path.join(testDir, "broken/file.bin"))).toBe(false);
    expect(await fs.readdir(path.join(testDir, "broken"))).toEqual([]);
  });

  it("keeps the previous file intact when an overwrite fails", async () => {
    const original = Buffer.from("original");
    await storage.upload("keep/file.txt", Readable.from(original), original.length, "text/plain");
    const body = new Readable({ read(): void {} });
    setTimeout(() => body.destroy(new Error("source died")), 10);

    await storage.upload("keep/file.txt", body, 100, "text/plain").catch(() => undefined);

    expect(await fs.readFile(path.join(testDir, "keep/file.txt"), "utf8")).toBe("original");
  });

  it("rejects and leaves no file when fewer bytes arrive than the declared size", async () => {
    const content = Buffer.from("short");
    const err = await storage
      .upload("short/file.txt", Readable.from(content), 999, "text/plain")
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect(await fs.readdir(path.join(testDir, "short"))).toEqual([]);
  });
});
