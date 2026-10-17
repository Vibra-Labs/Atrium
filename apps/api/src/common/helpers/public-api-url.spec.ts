import { describe, expect, it } from "bun:test";
import { publicApiUrl } from "./public-api-url";

function config(env: Record<string, string>): { get: (key: string) => string | undefined } {
  return { get: (key: string) => env[key] };
}

describe("publicApiUrl", () => {
  it("prefers API_URL over the legacy BETTER_AUTH_URL", () => {
    expect(publicApiUrl(config({ API_URL: "https://new.example.com", BETTER_AUTH_URL: "https://old.example.com" }))).toBe(
      "https://new.example.com",
    );
  });

  it("falls back to BETTER_AUTH_URL for pre-1.4 deployments", () => {
    expect(publicApiUrl(config({ BETTER_AUTH_URL: "https://old.example.com" }))).toBe("https://old.example.com");
  });

  it("treats an empty API_URL as unset", () => {
    expect(publicApiUrl(config({ API_URL: "", BETTER_AUTH_URL: "https://old.example.com" }))).toBe(
      "https://old.example.com",
    );
  });

  it("defaults to the local API port", () => {
    expect(publicApiUrl(config({}))).toBe("http://localhost:3001");
  });

  // A trailing slash reaches OAuth metadata as `//.well-known/...`.
  it("strips every trailing slash", () => {
    expect(publicApiUrl(config({ API_URL: "https://atrium.example.com//" }))).toBe("https://atrium.example.com");
  });
});
