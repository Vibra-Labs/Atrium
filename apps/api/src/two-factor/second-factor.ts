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

/** Why the gate refused a request. Sent as `code` in the 403 body. */
export type GateRefusal = "SECOND_FACTOR_REQUIRED" | "TWO_FACTOR_REQUIRED";

export interface GateInput {
  /**
   * Better Auth routes as `auth:<route>` (e.g. "auth:/two-factor/verify-totp"),
   * Atrium routes as the request path (e.g. "/api/two-factor/status").
   */
  route: string;
  /** The user has at least one second factor. */
  hasFactor: boolean;
  /** The session's `secondFactor`. */
  secondFactor: string | null;
  /** Staff in a workspace that requires 2FA, with no factor yet. */
  enrollmentOwed: boolean;
}

/** Open in any state: reading yourself, signing out, and starting a new sign-in. */
const OPEN_ROUTES: readonly string[] = [
  "auth:/get-session",
  "auth:/sign-out",
  "auth:/sign-in/*",
  "auth:/sign-up/*",
  "auth:/magic-link/verify",
  "auth:/request-password-reset",
  "auth:/reset-password",
  "auth:/reset-password/*",
  "auth:/verify-email",
  "auth:/send-verification-email",
  "/api/two-factor/status",
];

/** Open to a pending session: proving the second factor. */
const STEP_UP_ROUTES: readonly string[] = ["auth:/two-factor/verify-totp", "auth:/two-factor/verify-backup-code"];

/** Open to staff who owe enrollment: setting up a factor, or going to another workspace. */
const ENROLL_ROUTES: readonly string[] = [
  "auth:/two-factor/enable",
  "auth:/two-factor/verify-totp",
  "auth:/two-factor/get-totp-uri",
  "auth:/organization/list",
  "auth:/organization/set-active",
];

function matches(route: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern: string) =>
    pattern.endsWith("/*") ? route.startsWith(pattern.slice(0, -1)) : route === pattern,
  );
}

/** Whether a user has a second factor. Passkeys join this in PR 2. */
export function hasSecondFactor(user: { twoFactorEnabled?: boolean | null }): boolean {
  return user.twoFactorEnabled === true;
}

/**
 * The core rule: a session whose user has a second factor, but which never
 * passed one, may only step up, read itself or sign out. Staff who owe
 * enrollment may only enroll or switch workspace.
 */
export function gateDecision(input: GateInput): GateRefusal | null {
  const { route } = input;
  if (input.hasFactor && input.secondFactor === null) {
    return matches(route, OPEN_ROUTES) || matches(route, STEP_UP_ROUTES) ? null : "SECOND_FACTOR_REQUIRED";
  }
  if (input.enrollmentOwed) {
    return matches(route, OPEN_ROUTES) || matches(route, ENROLL_ROUTES) ? null : "TWO_FACTOR_REQUIRED";
  }
  return null;
}
