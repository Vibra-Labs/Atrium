import { describe, expect, it } from "bun:test";
import { logoSrc } from "./logo-src";

describe("logoSrc", () => {
  const uploaded = { logoKey: "logos/a b.png", organizationId: "org_1" };

  // The browser loads this URL, so it must never be the server-side API
  // address (127.0.0.1 inside the Docker image).
  it("is same-origin when no public API URL is configured", () => {
    expect(logoSrc(uploaded, "")).toBe("/api/branding/logo/org_1?k=logos%2Fa%20b.png");
  });

  it("uses the public API URL for split deployments", () => {
    expect(logoSrc(uploaded, "https://api.example.com")).toBe(
      "https://api.example.com/api/branding/logo/org_1?k=logos%2Fa%20b.png",
    );
  });

  it("returns an external logo URL as is", () => {
    expect(logoSrc({ logoUrl: "https://cdn.example.com/logo.png" }, "")).toBe("https://cdn.example.com/logo.png");
  });

  it("returns null without branding or a logo", () => {
    expect(logoSrc(null, "")).toBeNull();
    expect(logoSrc({}, "")).toBeNull();
  });
});
