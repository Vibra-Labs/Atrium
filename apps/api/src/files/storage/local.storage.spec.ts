import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { LocalStorage } from "./local.storage";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
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
    await storage.upload("test/file.txt", content, "text/plain");

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
    await storage.upload("to-delete.txt", content, "text/plain");
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
    await storage.upload("a/b/c/file.txt", content, "text/plain");

    const result = await storage.download("a/b/c/file.txt");
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe("nested");
  });
});
