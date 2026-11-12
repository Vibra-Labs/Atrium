import { describe, expect, it, mock } from "bun:test";
import { verifyOwnCode } from "./verify-own-code";
import type { CodeApi } from "./verify-own-code";

function api(ok: boolean) {
  const verifyTOTP = mock((): Promise<unknown> => (ok ? Promise.resolve({}) : Promise.reject(new Error("INVALID_CODE"))));
  const verifyBackupCode = mock((): Promise<unknown> => (ok ? Promise.resolve({}) : Promise.reject(new Error("INVALID"))));
  return { api: { verifyTOTP, verifyBackupCode } as CodeApi, verifyTOTP, verifyBackupCode };
}

describe("verifyOwnCode", () => {
  it("checks a 6-digit code as TOTP", async () => {
    const { api: a, verifyTOTP, verifyBackupCode } = api(true);
    expect(await verifyOwnCode(a, "123456", new Headers())).toBe(true);
    expect(verifyTOTP).toHaveBeenCalledTimes(1);
    expect(verifyBackupCode).not.toHaveBeenCalled();
  });

  it("checks the recovery-code shape as a recovery code", async () => {
    const { api: a, verifyBackupCode } = api(true);
    expect(await verifyOwnCode(a, "abcde-12345", new Headers())).toBe(true);
    expect(verifyBackupCode).toHaveBeenCalledTimes(1);
  });

  it("answers false for a wrong code", async () => {
    const { api: a } = api(false);
    expect(await verifyOwnCode(a, "000000", new Headers())).toBe(false);
  });
});
