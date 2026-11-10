import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { PrismaService } from "../prisma/prisma.service";
import { MCP_ACTOR_ROLES } from "../common";

const logger = new Logger("McpConsentHooks");

/** The parts of a signed authorization request the consent flow relies on. */
export interface SignedConsentRequest {
  /** The request's signature: unique per request, so it keys the parked choice. */
  requestId: string;
  clientId: string;
  redirectURI: string;
  /** When the signed request stops being accepted; a parked choice dies with it. */
  expiresAt: Date;
}

/**
 * Reads the authorization request Better Auth signed onto the consent page's
 * URL (`oauth_query`). Returns null for anything unsigned, tampered with or
 * expired, so the client and destination always come from Better Auth, never
 * from whoever built the link.
 */
export async function readSignedConsentRequest(
  oauthQuery: string,
  secret: string,
): Promise<SignedConsentRequest | null> {
  if (!oauthQuery || !(await verifyOAuthQueryParams(oauthQuery, secret))) return null;
  const params = new URLSearchParams(oauthQuery);
  const requestId: string | null = params.get("sig");
  const clientId: string | null = params.get("client_id");
  const redirectURI: string | null = params.get("redirect_uri");
  const exp: number = Number(params.get("exp"));
  if (!requestId || !clientId || !redirectURI || !Number.isFinite(exp)) return null;
  return { requestId, clientId, redirectURI, expiresAt: new Date(exp * 1000) };
}

/**
 * Applies the workspace choice the consent screen parked for this request.
 *
 * The choice is recorded as an `McpPendingGrant` before the user's Allow is
 * sent, and only becomes an `McpGrant` here, once `/oauth2/consent` has
 * actually succeeded — so a consent that fails never re-points (and signs
 * out) a connection the user still has.
 *
 * This is the only code path that writes an `McpGrant`.
 */
export async function promoteGrantOnConsent(
  prisma: PrismaService,
  request: SignedConsentRequest,
  sessionUserId: string,
): Promise<void> {
  // Keyed by user as well as request, so only the person consenting can have
  // parked the choice that their consent promotes.
  const key: { requestId_userId: { requestId: string; userId: string } } = { requestId_userId: { requestId: request.requestId, userId: sessionUserId } };
  const pending = await prisma.mcpPendingGrant.findUnique({ where: key });
  if (!pending) return;
  if (pending.clientId !== request.clientId) {
    logger.warn(`Refusing to promote a pending MCP grant that does not match its consent (client ${pending.clientId})`);
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
    // Tokens carry no workspace of their own — they resolve through this
    // grant — so re-consenting into a different workspace would silently
    // re-point a connection the user authorized for the old one. Those
    // tokens are signed out instead. The token for this consent is issued
    // afterwards, so it is unaffected.
    if (existing && existing.organizationId !== organizationId) {
      await tx.oauthAccessToken.deleteMany({ where: { userId, clientId } });
      await tx.oauthRefreshToken.deleteMany({ where: { userId, clientId } });
    }
    await tx.mcpGrant.upsert({
      where: { userId_clientId: { userId, clientId } },
      create: { userId, clientId, organizationId, memberId: member.id },
      update: { organizationId, memberId: member.id },
    });
    await tx.mcpPendingGrant.delete({ where: key });
  });
}

/** Whether the consent endpoint's `{ url }` result redirects back with an authorization code. */
function issuedCode(returned: unknown): boolean {
  const url: unknown = (returned as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== "string") return false;
  try {
    return new URL(url, "http://localhost").searchParams.has("code");
  } catch (err) {
    logger.warn(`Consent returned an unparseable redirect: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
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
  secret: string,
  outcome: ConsentOutcome,
): Promise<void> {
  if (outcome.returned instanceof APIError || !outcome.sessionUserId) return;

  const body = (typeof outcome.body === "object" && outcome.body !== null ? outcome.body : {}) as {
    accept?: unknown;
    oauth_query?: unknown;
  };
  if (typeof body.oauth_query !== "string") return;
  const request: SignedConsentRequest | null = await readSignedConsentRequest(body.oauth_query, secret);
  if (!request) return;

  if (body.accept !== true) {
    await prisma.mcpPendingGrant.deleteMany({
      where: { requestId: request.requestId, userId: outcome.sessionUserId },
    });
    return;
  }

  // An accepted consent re-runs authorize, which reports its failures (client
  // disabled, bad scope, ...) as a redirect to an error URL, not an APIError.
  // Only a redirect that carries a code means the client was let in.
  if (!issuedCode(outcome.returned)) return;

  try {
    await promoteGrantOnConsent(prisma, request, outcome.sessionUserId);
  } catch (err) {
    // better-call swallows this into its own console output, so record it
    // here: a consent the user saw succeed would otherwise leave no grant
    // and no trace.
    logger.error(
      `Failed to promote the MCP grant for client ${request.clientId} and user ${outcome.sessionUserId}`,
      err instanceof Error ? err.stack : String(err),
    );
    throw err;
  }
}
