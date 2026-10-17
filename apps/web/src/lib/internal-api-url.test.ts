import { describe, expect, it } from "bun:test";
import { forwardHeaders, resolveInternalApiUrl } from "./internal-api-url";

describe("resolveInternalApiUrl", () => {
  it("uses INTERNAL_API_URL", () => {
    expect(resolveInternalApiUrl({ INTERNAL_API_URL: "http://atrium-api:3001", NODE_ENV: "production" })).toBe(
      "http://atrium-api:3001",
    );
  });

  it("strips trailing slashes so paths join cleanly", () => {
    expect(resolveInternalApiUrl({ INTERNAL_API_URL: "http://atrium-api:3001//" })).toBe("http://atrium-api:3001");
  });

  it("defaults to the local API port in development", () => {
    expect(resolveInternalApiUrl({ NODE_ENV: "development" })).toBe("http://localhost:3001");
  });

  // Falling back to the public API_URL would silently send every page render
  // out over the internet and back.
  it("is required in production, even when API_URL is set", () => {
    expect(() => resolveInternalApiUrl({ NODE_ENV: "production", API_URL: "https://api.example.com" })).toThrow(
      /INTERNAL_API_URL/,
    );
  });

  it("treats an empty value as unset", () => {
    expect(() => resolveInternalApiUrl({ NODE_ENV: "production", INTERNAL_API_URL: "" })).toThrow(/INTERNAL_API_URL/);
  });
});

describe("forwardHeaders", () => {
  it("forwards the session cookie", () => {
    expect(forwardHeaders("session=abc", null)).toEqual({ Cookie: "session=abc" });
  });

  // Every server-side call comes from one IP, so without the visitor's address
  // all page renders share a single rate-limit bucket on the API.
  it("forwards the visitor's X-Forwarded-For", () => {
    expect(forwardHeaders("session=abc", "203.0.113.7")).toEqual({
      Cookie: "session=abc",
      "X-Forwarded-For": "203.0.113.7",
    });
  });
});
