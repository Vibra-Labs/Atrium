import { describe, expect, it } from "bun:test";
import { stampFor } from "./second-factor";

describe("stampFor", () => {
  it("marks a session created by verify-totp as totp", () => {
    expect(stampFor({ path: "/two-factor/verify-totp", currentSecondFactor: null, userHasTotp: true })).toBe("totp");
  });

  it("marks a session created by verify-backup-code as backup_code", () => {
    expect(stampFor({ path: "/two-factor/verify-backup-code", currentSecondFactor: null, userHasTotp: true })).toBe(
      "backup_code",
    );
  });

  it("marks a password sign-in by a 2FA user as a trusted device", () => {
    expect(stampFor({ path: "/sign-in/email", currentSecondFactor: null, userHasTotp: true })).toBe("trusted_device");
  });

  it("leaves a password sign-in without 2FA unmarked", () => {
    expect(stampFor({ path: "/sign-in/email", currentSecondFactor: null, userHasTotp: false })).toBeNull();
  });

  it("never carries a factor into a magic-link sign-in", () => {
    expect(stampFor({ path: "/magic-link/verify", currentSecondFactor: "totp", userHasTotp: true })).toBeNull();
  });

  it("never carries a factor into a social sign-in callback", () => {
    expect(stampFor({ path: "/callback/google", currentSecondFactor: "totp", userHasTotp: true })).toBeNull();
  });

  it("carries the verified factor into the session change-password mints", () => {
    expect(stampFor({ path: "/change-password", currentSecondFactor: "totp", userHasTotp: true })).toBe("totp");
  });

  it("keeps a pending session pending through change-password", () => {
    expect(stampFor({ path: "/change-password", currentSecondFactor: null, userHasTotp: true })).toBeNull();
  });
});
