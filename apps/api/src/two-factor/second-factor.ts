/** The second factor a session passed. `null` on a session means none. */
export type SecondFactor = "totp" | "backup_code" | "trusted_device" | "passkey";

export interface StampInput {
  /** The Better Auth endpoint creating the session, e.g. "/sign-in/email". */
  path: string;
  /** The `secondFactor` of the session this request already had, if any. */
  currentSecondFactor: string | null;
  /** Whether the session's user has TOTP turned on. */
  userHasTotp: boolean;
  /** The request's session belongs to the user the new session is for. Defaults to true. */
  sameUser?: boolean;
}

const PASSWORD_SIGN_IN_PATHS: ReadonlySet<string> = new Set<string>(["/sign-in/email", "/sign-in/username"]);

/** Endpoints that replace the caller's own session, which keeps its status. */
const CARRY_OVER_PATHS: ReadonlySet<string> = new Set<string>([
  "/change-password",
  "/two-factor/enable",
  "/two-factor/disable",
]);

/** Which second factor a new session has passed, given how it was created. */
export function stampFor(input: StampInput): SecondFactor | null {
  const { path } = input;
  if (path === "/two-factor/verify-totp") return "totp";
  if (path === "/two-factor/verify-backup-code") return "backup_code";
  // Every passkey requires user verification (PIN or biometric), so it is a
  // full second factor. Registration is never a sign-in (createSession is refused).
  if (path === "/passkey/verify-authentication") return "passkey";
  // The plugin's own after-hook deletes this session whenever a challenge is
  // still owed, so it survives only when the trusted-device cookie was valid.
  if (PASSWORD_SIGN_IN_PATHS.has(path)) return input.userHasTotp ? "trusted_device" : null;
  // Only a listed replacement of the caller's own session carries its status;
  // every other path (email link, sign-up, social, anything new) starts unverified.
  if (CARRY_OVER_PATHS.has(path) && input.sameUser !== false && input.currentSecondFactor !== null) {
    return input.currentSecondFactor as SecondFactor;
  }
  return null;
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
  // A passkey sign-in is a new sign-in, like /sign-in/*, and is also how a
  // pending session steps up.
  "auth:/passkey/generate-authenticate-options",
  "auth:/passkey/verify-authentication",
  "/api/two-factor/status",
];

/** Open to a pending session: proving the second factor. */
const STEP_UP_ROUTES: readonly string[] = ["auth:/two-factor/verify-totp", "auth:/two-factor/verify-backup-code"];

/** Open to staff who owe enrollment: setting up a factor, or going to another workspace. */
const ENROLL_ROUTES: readonly string[] = [
  "auth:/two-factor/enable",
  "auth:/two-factor/verify-totp",
  "auth:/two-factor/get-totp-uri",
  "auth:/passkey/generate-register-options",
  "auth:/passkey/verify-registration",
  "auth:/organization/list",
  "auth:/organization/set-active",
];

function matches(route: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern: string) =>
    pattern.endsWith("/*") ? route.startsWith(pattern.slice(0, -1)) : route === pattern,
  );
}

/** Routes open in any state, including when the session could not be resolved. */
export function isOpenRoute(route: string): boolean {
  return matches(route, OPEN_ROUTES);
}

/**
 * Better Auth routes that can act on a workspace other than the active one
 * (an explicit organizationId, or the MCP consent's workspace choice).
 */
export function isCrossWorkspaceRoute(route: string): boolean {
  return route.startsWith("auth:/organization/") || route.startsWith("auth:/oauth2/");
}

/** Whether a user has a second factor: TOTP or at least one passkey. */
export function hasSecondFactor(user: { twoFactorEnabled?: boolean | null; hasPasskey?: boolean }): boolean {
  return user.twoFactorEnabled === true || user.hasPasskey === true;
}

/** How recent a passkey sign-in must be to count as "confirm with your passkey". */
const PASSKEY_PROOF_MS: number = 5 * 60 * 1000;

/**
 * A passkey ceremony always creates a new session, so a session stamped
 * "passkey" and created moments ago proves the passkey was just used.
 */
export function passkeyProofIsRecent(
  session: { secondFactor?: string | null; createdAt: Date },
  now: number,
): boolean {
  return session.secondFactor === "passkey" && now - new Date(session.createdAt).getTime() <= PASSKEY_PROOF_MS;
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
