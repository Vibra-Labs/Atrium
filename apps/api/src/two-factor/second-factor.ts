/** The second factor a session passed. `null` on a session means none. */
export type SecondFactor = "totp" | "backup_code" | "trusted_device";

export interface StampInput {
  /** The Better Auth endpoint creating the session, e.g. "/sign-in/email". */
  path: string;
  /** The `secondFactor` of the session this request already had, if any. */
  currentSecondFactor: string | null;
  /** Whether the session's user has TOTP turned on. */
  userHasTotp: boolean;
}

const PASSWORD_SIGN_IN_PATHS: ReadonlySet<string> = new Set<string>(["/sign-in/email", "/sign-in/username"]);

/** Sign-in routes that prove nothing beyond the first factor. */
const FIRST_FACTOR_ONLY_PATHS: ReadonlySet<string> = new Set<string>([
  "/magic-link/verify",
  "/verify-email",
  "/sign-up/email",
]);

/** Which second factor a new session has passed, given how it was created. */
export function stampFor(input: StampInput): SecondFactor | null {
  const { path } = input;
  if (path === "/two-factor/verify-totp") return "totp";
  if (path === "/two-factor/verify-backup-code") return "backup_code";
  // The plugin's own after-hook deletes this session whenever a challenge is
  // still owed, so it survives only when the trusted-device cookie was valid.
  if (PASSWORD_SIGN_IN_PATHS.has(path)) return input.userHasTotp ? "trusted_device" : null;
  if (FIRST_FACTOR_ONLY_PATHS.has(path) || path.startsWith("/callback/")) return null;
  // Endpoints that replace the caller's own session (change-password, 2FA
  // enable/disable) carry its status over. Carrying never upgrades a session.
  return input.currentSecondFactor === null ? null : (input.currentSecondFactor as SecondFactor);
}
