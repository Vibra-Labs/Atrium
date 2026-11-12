import { describe, expect, it, mock } from "bun:test";
import { INTERNAL_CHECK_TOKEN, verifyOwnCode } from "./verify-own-code";
import { INTERNAL_CHECK_HEADER } from "./two-factor-hooks";
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

describe("verifyOwnCode marks its check as internal", () => {
  it("sends the per-process secret, and keeps the caller's cookie", async () => {
    const { api: a, verifyBackupCode } = api(true);
    await verifyOwnCode(a, "abcde-12345", new Headers({ cookie: "session=abc" }));
    const [call] = verifyBackupCode.mock.calls[0] as unknown as [{ headers: Headers }];
    expect(call.headers.get(INTERNAL_CHECK_HEADER)).toBe(INTERNAL_CHECK_TOKEN);
    expect(call.headers.get("cookie")).toBe("session=abc");
    expect(INTERNAL_CHECK_TOKEN.length).toBeGreaterThanOrEqual(32);
  });
});
