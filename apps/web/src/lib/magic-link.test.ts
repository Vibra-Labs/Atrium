import { describe, expect, it } from "bun:test";
import { magicLinkErrorMessage, magicLinkVerifyUrl, safeNextPath } from "./magic-link";

describe("safeNextPath", () => {
  it("keeps a same-site path with its query", () => {
    expect(safeNextPath("/portal/projects/p1?tab=updates")).toBe("/portal/projects/p1?tab=updates");
  });

  it("rejects anything that could leave the site", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("https://evil.test")).toBeNull();
    expect(safeNextPath("//evil.test")).toBeNull();
    expect(safeNextPath("/\\evil.test")).toBeNull();
    expect(safeNextPath("portal")).toBeNull();
  });
});

describe("magicLinkVerifyUrl", () => {
  it("points the emailed query at the API's verify endpoint", () => {
    expect(magicLinkVerifyUrl("?token=t&callbackURL=%2Fportal", "https://api.test")).toBe(
      "https://api.test/api/auth/magic-link/verify?token=t&callbackURL=%2Fportal",
    );
  });

  it("works with a same-origin API (empty apiUrl)", () => {
    expect(magicLinkVerifyUrl("?token=t", "")).toBe("/api/auth/magic-link/verify?token=t");
  });

  it("returns null without a token", () => {
    expect(magicLinkVerifyUrl("", "https://api.test")).toBeNull();
    expect(magicLinkVerifyUrl("?callbackURL=%2Fportal", "https://api.test")).toBeNull();
  });
});

describe("magicLinkErrorMessage", () => {
  it("explains an expired or used link", () => {
    expect(magicLinkErrorMessage("EXPIRED_TOKEN")).toContain("expired");
    expect(magicLinkErrorMessage("INVALID_TOKEN")).toContain("expired");
  });

  it("is silent without an error", () => {
    expect(magicLinkErrorMessage(null)).toBeNull();
  });
});
