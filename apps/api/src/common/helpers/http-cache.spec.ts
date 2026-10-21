import { describe, expect, it } from "bun:test";
import { DOWNLOAD_CACHE, logoCacheControl, shouldCompress } from "./http-cache";

describe("logoCacheControl", () => {
  it("is immutable when the URL carries the storage key", () => {
    expect(logoCacheControl("branding/o/logo-1.png")).toBe("public, max-age=31536000, immutable");
  });

  it("is short-lived without a key", () => {
    expect(logoCacheControl(undefined)).toBe("public, max-age=60");
    expect(logoCacheControl("")).toBe("public, max-age=60");
  });

  it("downloads are private for an hour", () => {
    expect(DOWNLOAD_CACHE).toBe("private, max-age=3600");
  });
});

describe("shouldCompress", () => {
  const req = (url: string): never => ({ originalUrl: url, headers: {} }) as never;
  const res: never = { getHeader: () => "application/json" } as never;

  it("skips file downloads and update attachments", () => {
    expect(shouldCompress(req("/api/files/abc/download"), res)).toBe(false);
    expect(shouldCompress(req("/api/files/abc/download?x=1"), res)).toBe(false);
    expect(shouldCompress(req("/api/updates/abc/attachment"), res)).toBe(false);
  });

  it("keeps compressing other responses", () => {
    expect(shouldCompress(req("/api/projects"), res)).toBe(true);
    expect(shouldCompress(req("/api/files/project/abc"), res)).toBe(true);
  });
});
