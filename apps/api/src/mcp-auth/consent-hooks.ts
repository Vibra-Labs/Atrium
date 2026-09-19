import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { PrismaService } from "../prisma/prisma.service";

const logger = new Logger("McpConsentHooks");

/** What Better Auth's oidc-provider stores in an authorization request's row. */
interface AuthorizationCodeValue {
  requireConsent?: unknown;
}

/**
 * Refuses a token exchange for a code the user has not approved yet.
 *
 * In Better Auth 1.4.18 the consent code *is* the authorization code: the
 * consent page is handed the identifier of the verification row, and
 * `/oauth2/consent` merely renames that row and flips `requireConsent` to
 * false. `/mcp/token` never reads the flag, so the code sitting in the consent
 * page's URL can be exchanged for a real access token without anyone pressing
 * Allow — and with an existing grant that token resolves to a workspace.
 *
 * A row we cannot read is left alone: it belongs to some other feature, or the
 * code is unknown, and the plugin's own `invalid_grant` answer is the right one.
 */
export async function assertConsentGranted(prisma: PrismaService, code: string): Promise<void> {
  const row = await prisma.verification.findFirst({ where: { identifier: code } });
  if (!row) return;

  let value: AuthorizationCodeValue;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null) return;
    value = parsed as AuthorizationCodeValue;
  } catch (err) {
    logger.warn(
      `Token-exchange code did not hold an authorization request: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (value.requireConsent === true) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_grant",
      error_description: "Consent has not been granted.",
    });
  }
}
