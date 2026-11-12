import { describe, expect, it } from "bun:test";
import { passkeyErrorMessage } from "./passkeys";

describe("passkeyErrorMessage", () => {
  it("stays silent when the person cancels the browser prompt", () => {
    expect(passkeyErrorMessage(Object.assign(new Error("x"), { code: "ERROR_CEREMONY_ABORTED" }))).toBeNull();
    expect(passkeyErrorMessage(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBeNull();
  });

  it("asks for a fresh sign-in when the session is too old to add a passkey", () => {
    expect(passkeyErrorMessage(null, "SESSION_NOT_FRESH")).toBe("For your security, sign in again to add a passkey.");
  });

  it("explains a device that already has a passkey for this account", () => {
    expect(
      passkeyErrorMessage(Object.assign(new Error("x"), { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })),
    ).toBe("This device already has a passkey for your account.");
  });

  it("falls back to the server's message, then a generic one", () => {
    expect(passkeyErrorMessage(null, undefined, "Passkeys are for workspace owners and admins.")).toBe(
      "Passkeys are for workspace owners and admins.",
    );
    expect(passkeyErrorMessage(new Error(""))).toBe("Something went wrong with the passkey. Please try again.");
  });
});
