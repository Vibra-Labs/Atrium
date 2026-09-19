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

/**
 * Applies the workspace choice the consent screen parked for this code.
 *
 * Better Auth consumes the consent-code row when the user presses Allow, so
 * the browser cannot write the grant first and consent second — a consent that
 * then failed would have re-pointed (and signed out) a connection the user
 * still had. The choice is therefore recorded as an `McpPendingGrant` and only
 * becomes an `McpGrant` here, once `/oauth2/consent` has actually succeeded.
 *
 * This is the only code path that writes an `McpGrant`.
 */
export async function promoteGrantOnConsent(
  prisma: PrismaService,
  consentCode: string,
  sessionUserId: string,
): Promise<void> {
  const pending = await prisma.mcpPendingGrant.findUnique({ where: { consentCode } });
  if (!pending) return;
  // The pending row and the consent that promotes it must belong to the same
  // person; otherwise anyone who learned a consent code could bind it.
  if (pending.userId !== sessionUserId) {
    logger.warn(`Refusing to promote a pending MCP grant for a different user (client ${pending.clientId})`);
    return;
  }

  const { userId, clientId, organizationId } = pending;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.mcpGrant.findUnique({
      where: { userId_clientId: { userId, clientId } },
      select: { organizationId: true },
    });
    // Access tokens carry no workspace of their own — they resolve through
    // this grant — so re-consenting into a different workspace would silently
    // re-point a session the user authorized for the old one. Those tokens are
    // signed out instead. The token for this consent is issued afterwards, so
    // it is unaffected.
    if (existing && existing.organizationId !== organizationId) {
      await tx.oauthAccessToken.deleteMany({ where: { userId, clientId } });
    }
    await tx.mcpGrant.upsert({
      where: { userId_clientId: { userId, clientId } },
      create: { userId, clientId, organizationId },
      update: { organizationId },
    });
    await tx.mcpPendingGrant.delete({ where: { consentCode } });
  });
}

/** Drops a parked workspace choice the user did not go through with. */
export async function discardPendingGrant(
  prisma: PrismaService,
  consentCode: string,
): Promise<void> {
  await prisma.mcpPendingGrant.deleteMany({ where: { consentCode } });
}
