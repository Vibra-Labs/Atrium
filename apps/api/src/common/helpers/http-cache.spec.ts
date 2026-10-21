import { describe, expect, it } from "bun:test";
import { DOWNLOAD_CACHE, logoCacheControl, shouldCompress } from "./http-cache";

describe("logoCacheControl", () => {
  const stored = "branding/o/logo-1.png";

  it("is immutable when the URL carries the current storage key", () => {
    expect(logoCacheControl(stored, stored)).toBe("public, max-age=31536000, immutable");
  });

  it("is short-lived without a key", () => {
    expect(logoCacheControl(undefined, stored)).toBe("public, max-age=60");
    expect(logoCacheControl("", stored)).toBe("public, max-age=60");
  });

  it("is short-lived when the key is stale or made up", () => {
    // Otherwise any ?k= value would pin whatever logo is current forever.
    expect(logoCacheControl("branding/o/logo-0.png", stored)).toBe("public, max-age=60");
    expect(logoCacheControl("anything", stored)).toBe("public, max-age=60");
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
