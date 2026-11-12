import { describe, expect, it } from "bun:test";
import { passkeyRelyingParty, passkeysEnabled, passkeyUnavailableReason } from "./passkeys";

function config(values: Record<string, string>): { get: (key: string) => string | undefined } {
  return { get: (key: string): string | undefined => values[key] };
}

describe("passkey availability", () => {
  it("is on for an https web address, pinned to that host", () => {
    const c = config({ WEB_URL: "https://app.example.com" });
    expect(passkeysEnabled(c)).toBe(true);
    expect(passkeyRelyingParty(c)).toEqual({ rpID: "app.example.com", origin: "https://app.example.com" });
  });

  it("is on for localhost over http", () => {
    const c = config({ WEB_URL: "http://localhost:3000" });
    expect(passkeysEnabled(c)).toBe(true);
    expect(passkeyRelyingParty(c)).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
  });

  it("is off for a plain-http address", () => {
    expect(passkeyUnavailableReason(config({ WEB_URL: "http://portal.lan" }))).toContain("https://");
  });

  it("is off behind the Firebase Hosting cookie workaround", () => {
    const c = config({ WEB_URL: "https://app.example.com", FIREBASE_HOSTING: "true" });
    expect(passkeyUnavailableReason(c)).toContain("FIREBASE_HOSTING");
  });

  it("defaults to the local web address", () => {
    expect(passkeyRelyingParty(config({}))).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
  });
});
