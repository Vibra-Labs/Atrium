import { randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import { INTERNAL_CHECK_HEADER } from "./two-factor-hooks";

/** Better Auth's two code-checking endpoints; `auth`'s plugin-less type leaves them out. */
type VerifyCode = (input: { body: { code: string }; headers: Headers }) => Promise<unknown>;
export interface CodeApi {
  verifyTOTP: VerifyCode;
  verifyBackupCode: VerifyCode;
}

/** Recovery codes look like "abcde-12345"; authenticator codes are digits. */
const RECOVERY_CODE_SHAPE: RegExp = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

/**
 * Made once per process. The check below calls Better Auth in-process, so its
 * after-hook sees this value and knows the call came from here, not a client.
 */
export const INTERNAL_CHECK_TOKEN: string = randomBytes(32).toString("hex");

/**
 * Checks a code against the session in `headers`: an authenticator code, or a
 * recovery code (which this uses up). False for a wrong code.
 */
export async function verifyOwnCode(api: CodeApi, code: string, headers: Headers): Promise<boolean> {
  const verify: VerifyCode = RECOVERY_CODE_SHAPE.test(code) ? api.verifyBackupCode : api.verifyTOTP;
  const marked: Headers = new Headers(headers);
  marked.set(INTERNAL_CHECK_HEADER, INTERNAL_CHECK_TOKEN);
  try {
    await verify({ body: { code }, headers: marked });
    return true;
  } catch (err) {
    Logger.warn(`Two-factor code check failed: ${err instanceof Error ? err.message : String(err)}`, "verifyOwnCode");
    return false;
  }
}
