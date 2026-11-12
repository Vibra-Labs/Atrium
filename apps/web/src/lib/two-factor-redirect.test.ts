import { describe, expect, it } from "bun:test";
import { pageForStatus, redirectForGateCode } from "./two-factor-redirect";

describe("redirectForGateCode", () => {
  it("sends a pending session to the code screen", () => {
    expect(redirectForGateCode("SECOND_FACTOR_REQUIRED")).toBe("/login/2fa");
  });

  it("sends staff who owe enrollment to setup", () => {
    expect(redirectForGateCode("TWO_FACTOR_REQUIRED")).toBe("/2fa/setup");
  });

  it("ignores anything else", () => {
    expect(redirectForGateCode("CSRF")).toBeNull();
    expect(redirectForGateCode(undefined)).toBeNull();
  });
});

describe("pageForStatus", () => {
  it("sends a pending session to the code screen first", () => {
    expect(pageForStatus({ pending: true, enrollmentRequired: true })).toBe("/login/2fa");
  });

  it("sends staff who owe enrollment to setup", () => {
    expect(pageForStatus({ pending: false, enrollmentRequired: true })).toBe("/2fa/setup");
  });

  it("lets everyone else through", () => {
    expect(pageForStatus({ pending: false, enrollmentRequired: false })).toBeNull();
    expect(pageForStatus(null)).toBeNull();
  });
});
