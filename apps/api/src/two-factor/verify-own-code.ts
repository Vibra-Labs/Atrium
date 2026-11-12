import { Logger } from "@nestjs/common";

/** Better Auth's two code-checking endpoints; `auth`'s plugin-less type leaves them out. */
type VerifyCode = (input: { body: { code: string }; headers: Headers }) => Promise<unknown>;
export interface CodeApi {
  verifyTOTP: VerifyCode;
  verifyBackupCode: VerifyCode;
}

/** Recovery codes look like "abcde-12345"; authenticator codes are digits. */
const RECOVERY_CODE_SHAPE: RegExp = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

/**
 * Checks a code against the session in `headers`: an authenticator code, or a
 * recovery code (which this uses up). False for a wrong code.
 */
export async function verifyOwnCode(api: CodeApi, code: string, headers: Headers): Promise<boolean> {
  const verify: VerifyCode = RECOVERY_CODE_SHAPE.test(code) ? api.verifyBackupCode : api.verifyTOTP;
  try {
    await verify({ body: { code }, headers });
    return true;
  } catch (err) {
    Logger.warn(`Two-factor code check failed: ${err instanceof Error ? err.message : String(err)}`, "verifyOwnCode");
    return false;
  }
}
