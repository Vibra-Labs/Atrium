/** Where the web app sends a user whose request the API refused for second-factor reasons. */
export type GatePage = "/login/2fa" | "/2fa/setup";

/** Maps the `code` of an API 403 to the page that resolves it, or null for any other 403. */
export function redirectForGateCode(code: string | undefined): GatePage | null {
  if (code === "SECOND_FACTOR_REQUIRED") return "/login/2fa";
  if (code === "TWO_FACTOR_REQUIRED") return "/2fa/setup";
  return null;
}

/** The routing parts of GET /api/two-factor/status. */
export interface GateStatus {
  pending: boolean;
  enrollmentRequired: boolean;
}

/** Where a signed-in user must go before any other page, or null to carry on. */
export function pageForStatus(status: GateStatus | null): GatePage | null {
  if (!status) return null;
  if (status.pending) return "/login/2fa";
  if (status.enrollmentRequired) return "/2fa/setup";
  return null;
}
