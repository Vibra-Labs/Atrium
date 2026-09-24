import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { PrismaService } from "../prisma/prisma.service";
import { MCP_ACTOR_ROLES } from "../common";

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
  // Identifiers are not unique, and the plugin's own findVerificationValue
  // sorts by createdAt desc with limit 1 — read the same row it will.
  const row = await prisma.verification.findFirst({
    where: { identifier: code },
    orderBy: { createdAt: "desc" },
  });
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
 * The `hooks.before` gate for `POST /mcp/token`.
 *
 * `/mcp/token` also accepts `application/json`, its body schema is
 * `z.record(z.any(), z.any())`, and better-call passes JSON through untouched —
 * so `code` can arrive as any shape at all. The plugin then does
 * `code.toString()`, which means `["<consentCode>"]` resolves to the very same
 * verification row. The check therefore coerces exactly as the plugin does,
 * rather than only looking at strings.
 *
 * The branch condition mirrors the plugin's too: it compares
 * `grant_type === "refresh_token"` strictly, so anything else — an array, a
 * number, or nothing at all — falls through to the code exchange and must be
 * checked here.
 */
export async function guardTokenExchange(prisma: PrismaService, body: unknown): Promise<void> {
  const fields = (typeof body === "object" && body !== null ? body : {}) as {
    grant_type?: unknown;
    code?: unknown;
  };
  if (fields.grant_type === "refresh_token") return;
  const code: unknown = fields.code;
  if (code === undefined || code === null) return;
  const presented: string = String(code);
  if (!presented) return;
  await assertConsentGranted(prisma, presented);
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
    // The consent screen checked the role, but the user may have been demoted
    // or removed since. The grant is pinned to this member row.
    const member = await tx.member.findFirst({ where: { userId, organizationId } });
    if (!member || !MCP_ACTOR_ROLES.includes(member.role)) {
      logger.warn(`Refusing to promote an MCP grant for a non-admin member (client ${clientId})`);
      return;
    }
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
      create: { userId, clientId, organizationId, memberId: member.id },
      update: { organizationId, memberId: member.id },
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

/** What the `hooks.after` on `/oauth2/consent` observed. */
export interface ConsentOutcome {
  /** The endpoint's result; an `APIError` means it failed. */
  returned: unknown;
  /** The request body, as the router parsed it. */
  body: unknown;
  /** The signed-in user, from the endpoint's session middleware. */
  sessionUserId: string | undefined;
}

/**
 * The `hooks.after` body for `POST /oauth2/consent`, kept here so it can be
 * exercised without a Better Auth request.
 *
 * Only a successful consent may move a grant: `runAfterHooks` hands a failed
 * endpoint's `APIError` back as `returned` instead of throwing it, so that is
 * what "succeeded" is decided on.
 */
export async function applyConsentOutcome(
  prisma: PrismaService,
  outcome: ConsentOutcome,
): Promise<void> {
  if (outcome.returned instanceof APIError) return;

  const body = (typeof outcome.body === "object" && outcome.body !== null ? outcome.body : {}) as {
    accept?: unknown;
    consent_code?: unknown;
  };
  const consentCode: unknown = body.consent_code;
  if (typeof consentCode !== "string" || !consentCode) return;

  if (body.accept !== true) {
    await discardPendingGrant(prisma, consentCode);
    return;
  }

  if (!outcome.sessionUserId) return;
  try {
    await promoteGrantOnConsent(prisma, consentCode, outcome.sessionUserId);
  } catch (err) {
    // better-call swallows this into its own console output, so record it
    // here: a consent the user saw succeed would otherwise have left no grant
    // and no trace. The consent code is exchangeable, so it is never logged.
    const pending = await prisma.mcpPendingGrant
      .findUnique({ where: { consentCode }, select: { clientId: true } })
      .catch((lookupErr: unknown) => {
        logger.error(
          `Could not read the pending MCP grant while reporting a failed promotion: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
        );
        return null;
      });
    logger.error(
      `Failed to promote the MCP grant for client ${pending?.clientId ?? "unknown"} and user ${outcome.sessionUserId}`,
      err instanceof Error ? err.stack : String(err),
    );
    throw err;
  }
}
