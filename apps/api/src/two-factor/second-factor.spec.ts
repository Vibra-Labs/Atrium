import { describe, expect, it } from "bun:test";
import { gateDecision, hasSecondFactor, passkeyProofIsRecent, stampFor } from "./second-factor";

describe("stampFor", () => {
  it("does not carry a factor into an unlisted path", () => {
    expect(stampFor({ path: "/sign-in/social", currentSecondFactor: "totp", userHasTotp: true })).toBeNull();
  });

  it("does not carry another user's factor", () => {
    expect(
      stampFor({ path: "/change-password", currentSecondFactor: "totp", userHasTotp: true, sameUser: false }),
    ).toBeNull();
  });

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

describe("gateDecision", () => {
  const pending = { hasFactor: true, secondFactor: null, enrollmentOwed: false };
  const owed = { hasFactor: false, secondFactor: null, enrollmentOwed: true };

  it("refuses an Atrium route to a pending session", () => {
    expect(gateDecision({ ...pending, route: "/api/projects" })).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("refuses Better Auth organization routes to a pending session", () => {
    expect(gateDecision({ ...pending, route: "auth:/organization/invite-member" })).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("refuses API key creation to a pending session", () => {
    expect(gateDecision({ ...pending, route: "auth:/api-key/create" })).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("refuses turning 2FA off from a pending session", () => {
    expect(gateDecision({ ...pending, route: "auth:/two-factor/disable" })).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("lets a pending session step up", () => {
    expect(gateDecision({ ...pending, route: "auth:/two-factor/verify-totp" })).toBeNull();
    expect(gateDecision({ ...pending, route: "auth:/two-factor/verify-backup-code" })).toBeNull();
  });

  it("lets a pending session read itself, check status and sign out", () => {
    expect(gateDecision({ ...pending, route: "auth:/get-session" })).toBeNull();
    expect(gateDecision({ ...pending, route: "/api/two-factor/status" })).toBeNull();
    expect(gateDecision({ ...pending, route: "auth:/sign-out" })).toBeNull();
  });

  it("lets a pending session start a new sign-in", () => {
    expect(gateDecision({ ...pending, route: "auth:/sign-in/email" })).toBeNull();
    expect(gateDecision({ ...pending, route: "auth:/magic-link/verify" })).toBeNull();
  });

  it("lets a verified session through", () => {
    expect(gateDecision({ hasFactor: true, secondFactor: "totp", enrollmentOwed: false, route: "/api/projects" })).toBeNull();
  });

  it("refuses an Atrium route to staff who owe enrollment", () => {
    expect(gateDecision({ ...owed, route: "/api/projects" })).toBe("TWO_FACTOR_REQUIRED");
  });

  it("lets staff who owe enrollment enroll and switch workspace", () => {
    expect(gateDecision({ ...owed, route: "auth:/two-factor/enable" })).toBeNull();
    expect(gateDecision({ ...owed, route: "auth:/two-factor/verify-totp" })).toBeNull();
    expect(gateDecision({ ...owed, route: "auth:/organization/list" })).toBeNull();
    expect(gateDecision({ ...owed, route: "auth:/organization/set-active" })).toBeNull();
  });

  it("lets a user with no factor and no requirement through", () => {
    expect(gateDecision({ hasFactor: false, secondFactor: null, enrollmentOwed: false, route: "/api/projects" })).toBeNull();
  });
});

describe("hasSecondFactor", () => {
  it("is true only when TOTP is on", () => {
    expect(hasSecondFactor({ twoFactorEnabled: true })).toBe(true);
    expect(hasSecondFactor({ twoFactorEnabled: false })).toBe(false);
    expect(hasSecondFactor({})).toBe(false);
  });
});

describe("passkeys in the rules", () => {
  it("stamps a passkey sign-in as passkey", () => {
    expect(stampFor({ path: "/passkey/verify-authentication", currentSecondFactor: null, userHasTotp: true })).toBe(
      "passkey",
    );
  });

  it("never stamps passkey registration", () => {
    expect(stampFor({ path: "/passkey/verify-registration", currentSecondFactor: "totp", userHasTotp: true })).toBeNull();
  });

  const pending = { hasFactor: true, secondFactor: null, enrollmentOwed: false };
  const owed = { hasFactor: false, secondFactor: null, enrollmentOwed: true };
  const verified = { hasFactor: true, secondFactor: "totp", enrollmentOwed: false };

  it("lets a pending session sign in with a passkey", () => {
    expect(gateDecision({ ...pending, route: "auth:/passkey/generate-authenticate-options" })).toBeNull();
    expect(gateDecision({ ...pending, route: "auth:/passkey/verify-authentication" })).toBeNull();
  });

  it("never lets a pending session register, list, rename or remove passkeys", () => {
    for (const route of [
      "auth:/passkey/generate-register-options",
      "auth:/passkey/verify-registration",
      "auth:/passkey/list-user-passkeys",
      "auth:/passkey/update-passkey",
      "auth:/passkey/delete-passkey",
    ]) {
      expect(gateDecision({ ...pending, route })).toBe("SECOND_FACTOR_REQUIRED");
    }
  });

  it("lets staff who owe setup enroll with a passkey", () => {
    expect(gateDecision({ ...owed, route: "auth:/passkey/generate-register-options" })).toBeNull();
    expect(gateDecision({ ...owed, route: "auth:/passkey/verify-registration" })).toBeNull();
    expect(gateDecision({ ...owed, route: "auth:/passkey/delete-passkey" })).toBe("TWO_FACTOR_REQUIRED");
  });

  it("lets a verified session manage passkeys", () => {
    expect(gateDecision({ ...verified, route: "auth:/passkey/delete-passkey" })).toBeNull();
  });

  it("counts a passkey as a second factor", () => {
    expect(hasSecondFactor({ twoFactorEnabled: false, hasPasskey: true })).toBe(true);
    expect(hasSecondFactor({ twoFactorEnabled: false, hasPasskey: false })).toBe(false);
  });

  it("treats a passkey session from the last 5 minutes as fresh proof", () => {
    const now: number = Date.parse("2026-11-11T12:00:00Z");
    const at = (msAgo: number): Date => new Date(now - msAgo);
    expect(passkeyProofIsRecent({ secondFactor: "passkey", createdAt: at(4 * 60_000 + 59_000) }, now)).toBe(true);
    expect(passkeyProofIsRecent({ secondFactor: "passkey", createdAt: at(5 * 60_000 + 1_000) }, now)).toBe(false);
    expect(passkeyProofIsRecent({ secondFactor: "totp", createdAt: at(1_000) }, now)).toBe(false);
  });
});
