import { describe, expect, it } from "bun:test";
import { cookieUrlWarning, insecureCookiesInProduction, secureCookies } from "./secure-cookies";

describe("secureCookies", () => {
  it("treats a blank SECURE_COOKIES as unset", () => {
    expect(secureCookies({ SECURE_COOKIES: "", NODE_ENV: "production" })).toBe(true);
    expect(secureCookies({ SECURE_COOKIES: "  ", WEB_URL: "https://atrium.example.com", NODE_ENV: "production" })).toBe(true);
    expect(secureCookies({ SECURE_COOKIES: "", WEB_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toBe(false);
  });

  it("lets an explicit SECURE_COOKIES win over the URL", () => {
    expect(secureCookies({ SECURE_COOKIES: "true", WEB_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toBe(true);
    expect(secureCookies({ SECURE_COOKIES: "false", WEB_URL: "https://atrium.example.com", NODE_ENV: "production" })).toBe(false);
  });

  it("turns Secure off for an explicit http:// URL in production", () => {
    expect(secureCookies({ WEB_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toBe(false);
  });

  it("ignores case and surrounding spaces in the scheme", () => {
    expect(secureCookies({ WEB_URL: "  HTTP://nas.local:8192 ", NODE_ENV: "production" })).toBe(false);
  });

  it("keeps Secure on for an https:// URL in production", () => {
    expect(secureCookies({ WEB_URL: "https://atrium.example.com", NODE_ENV: "production" })).toBe(true);
  });

  it("keeps Secure on in production when no URL is set", () => {
    expect(secureCookies({ NODE_ENV: "production" })).toBe(true);
  });

  it("keeps Secure on in production when the URL has no scheme", () => {
    expect(secureCookies({ WEB_URL: "10.0.0.5:8192", NODE_ENV: "production" })).toBe(true);
  });

  it("checks API_URL first, as Better Auth's base URL does", () => {
    expect(secureCookies({ API_URL: "https://api.example.com", WEB_URL: "http://10.0.0.5", NODE_ENV: "production" })).toBe(true);
    expect(secureCookies({ API_URL: "http://10.0.0.5:8192", WEB_URL: "https://app.example.com", NODE_ENV: "production" })).toBe(false);
  });

  it("falls back to the legacy BETTER_AUTH_URL", () => {
    expect(secureCookies({ BETTER_AUTH_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toBe(false);
  });

  it("treats an empty API_URL as unset", () => {
    expect(secureCookies({ API_URL: "", WEB_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toBe(false);
  });

  it("is off outside production when nothing is set", () => {
    expect(secureCookies({})).toBe(false);
  });
});

describe("insecureCookiesInProduction", () => {
  it("is true in production when cookies are not Secure", () => {
    expect(insecureCookiesInProduction({ WEB_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toBe(true);
    expect(insecureCookiesInProduction({ SECURE_COOKIES: "false", NODE_ENV: "production" })).toBe(true);
  });

  it("is false in production over https", () => {
    expect(insecureCookiesInProduction({ WEB_URL: "https://atrium.example.com", NODE_ENV: "production" })).toBe(false);
  });

  it("is false in development", () => {
    expect(insecureCookiesInProduction({ WEB_URL: "http://localhost:3000" })).toBe(false);
  });
});

describe("cookieUrlWarning", () => {
  it("warns when production cookies are not Secure", () => {
    expect(cookieUrlWarning({ WEB_URL: "http://10.0.0.5:8192", NODE_ENV: "production" })).toContain("plain HTTP");
  });

  it("is silent for https in production", () => {
    expect(cookieUrlWarning({ WEB_URL: "https://atrium.example.com", NODE_ENV: "production" })).toBeNull();
  });

  it("is silent when no URL is set", () => {
    expect(cookieUrlWarning({ NODE_ENV: "production" })).toBeNull();
  });

  it("is silent in development", () => {
    expect(cookieUrlWarning({ WEB_URL: "http://localhost:3000" })).toBeNull();
  });
});
