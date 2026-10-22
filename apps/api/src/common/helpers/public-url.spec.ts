import { describe, expect, it } from "bun:test";
import { publicUrlError } from "./public-url";

describe("publicUrlError", () => {
  it("accepts unset and blank URLs", () => {
    expect(publicUrlError({})).toBeNull();
    expect(publicUrlError({ WEB_URL: "", API_URL: "  " })).toBeNull();
  });

  it("accepts http and https URLs, with a port or path", () => {
    expect(publicUrlError({ WEB_URL: "https://atrium.example.com" })).toBeNull();
    expect(publicUrlError({ WEB_URL: "http://192.168.1.10:8192" })).toBeNull();
    expect(publicUrlError({ WEB_URL: "  HTTPS://Atrium.example.com/  " })).toBeNull();
  });

  it("rejects a URL without a scheme and says how to fix it", () => {
    const error: string | null = publicUrlError({ WEB_URL: "192.168.4.43:8192" });
    expect(error).toContain("WEB_URL");
    expect(error).toContain("192.168.4.43:8192");
    expect(error).toContain("http://");
  });

  it("rejects a bare hostname", () => {
    expect(publicUrlError({ WEB_URL: "atrium.example.com" })).toContain("WEB_URL");
  });

  it("rejects other schemes", () => {
    expect(publicUrlError({ WEB_URL: "ftp://atrium.example.com" })).toContain("WEB_URL");
  });

  it("checks API_URL and BETTER_AUTH_URL too", () => {
    expect(publicUrlError({ API_URL: "atrium.example.com" })).toContain("API_URL");
    expect(publicUrlError({ BETTER_AUTH_URL: "atrium.example.com" })).toContain("BETTER_AUTH_URL");
  });
});
