import { describe, expect, it } from "bun:test";
import { deviceLabel, shouldOfferPasskey } from "./passkey-prompt";

describe("shouldOfferPasskey", () => {
  const base = { passkeysOffered: true, passkeyCount: 0, onCustomDomain: false, dismissed: false };

  it("invites staff who have no passkey yet", () => {
    expect(shouldOfferPasskey(base)).toBe(true);
  });

  it("stays quiet once they have one, said not now, can't use passkeys, or are on a custom domain", () => {
    expect(shouldOfferPasskey({ ...base, passkeyCount: 1 })).toBe(false);
    expect(shouldOfferPasskey({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferPasskey({ ...base, passkeysOffered: false })).toBe(false);
    expect(shouldOfferPasskey({ ...base, onCustomDomain: true })).toBe(false);
  });
});

describe("deviceLabel", () => {
  it("names the device a passkey is created on", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("iPad");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("Android phone");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("This device");
  });
});
