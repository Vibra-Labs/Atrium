import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { hashOAuthToken, MCP_ACTOR_ROLES, ORG_MEMBER_FIELDS } from "../common";
import type { Actor } from "../common";
import { readSignedConsentRequest } from "./consent-hooks";
import type { SignedConsentRequest } from "./consent-hooks";

export type ResolvedOAuthToken = Actor & { oauthClientId: string };

const EXPIRED_CONSENT =
  "This request has expired. Start the connection again from your AI assistant.";

export interface GrantSummary {
  id: string;
  clientName: string;
  organizationName: string;
  userName: string;
  createdAt: Date;
  mine: boolean;
}

@Injectable()
export class McpAuthService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * The authorization request the consent page was opened for.
   *
   * The client and destination are read from the request Better Auth signed
   * onto the page's URL, never from plain query parameters, so a phishing
   * link cannot name one client while approving another.
   */
  async consentRequest(oauthQuery: string): Promise<SignedConsentRequest> {
    const request: SignedConsentRequest | null = await readSignedConsentRequest(
      oauthQuery,
      this.config.getOrThrow<string>("BETTER_AUTH_SECRET"),
    );
    if (!request) throw new NotFoundException(EXPIRED_CONSENT);
    return request;
  }

  /** OAuth access token → actor. Same role rule as API keys. */
  async resolve(token: string): Promise<ResolvedOAuthToken | null> {
    const row = await this.prisma.oauthAccessToken.findUnique({ where: { token: hashOAuthToken(token) } });
    if (!row || !row.userId || row.revoked) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    // A DPoP-bound token needs a proof this endpoint does not check. The token
    // endpoint never issues one (see auth.service.ts), so refuse rather than
    // treat it as a bearer token.
    if (row.confirmation !== null) return null;

    const grant = await this.prisma.mcpGrant.findUnique({
      where: { userId_clientId: { userId: row.userId, clientId: row.clientId } },
      include: { user: true, organization: true },
    });
    if (!grant) return null;

    const member = await this.prisma.member.findFirst({
      where: { id: grant.memberId, userId: row.userId, organizationId: grant.organizationId },
      select: ORG_MEMBER_FIELDS,
    });
    if (!member || !MCP_ACTOR_ROLES.includes(member.role)) return null;

    return { user: grant.user, organization: grant.organization, member, oauthClientId: row.clientId };
  }

  async getClient(clientId: string): Promise<{ clientId: string; name: string }> {
    const client = await this.prisma.oauthClient.findUnique({
      where: { clientId },
      select: { clientId: true, name: true },
    });
    if (!client) throw new NotFoundException("Unknown application");
    return { clientId: client.clientId, name: client.name || "Unnamed app" };
  }

  async adminOrganizations(userId: string): Promise<{ id: string; name: string }[]> {
    const memberships = await this.prisma.member.findMany({
      // Prisma's `in` takes a mutable array; the shared list is readonly.
      where: { userId, role: { in: [...MCP_ACTOR_ROLES] } },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return memberships.map((m) => m.organization);
  }

  /**
   * Records which workspace the user picked for this authorization request.
   *
   * Deliberately writes nothing but the pending row, so a consent that then
   * fails cannot leave a working connection re-pointed at a workspace it was
   * never approved for. `promoteGrantOnConsent` turns this into an `McpGrant`
   * once the consent endpoint has actually succeeded.
   */
  async savePendingGrant(
    request: SignedConsentRequest,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const { requestId, clientId, expiresAt } = request;
    const member = await this.prisma.member.findFirst({ where: { userId, organizationId } });
    if (!member || !MCP_ACTOR_ROLES.includes(member.role)) {
      throw new ForbiddenException("You must be an owner or admin of that workspace");
    }
    await this.getClient(clientId);
    await this.prisma.mcpPendingGrant.upsert({
      where: { requestId_userId: { requestId, userId } },
      create: { requestId, userId, clientId, organizationId, expiresAt },
      update: { clientId, organizationId, expiresAt },
    });
  }

  /** Admins see their own grants in this workspace; the owner sees everyone's. */
  async listGrants(userId: string, organizationId: string, role: string): Promise<GrantSummary[]> {
    const grants = await this.prisma.mcpGrant.findMany({
      where: { organizationId, ...(role === "owner" ? {} : { userId }) },
      include: { user: { select: { name: true } }, organization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const clients = await this.prisma.oauthClient.findMany({
      where: { clientId: { in: grants.map((g) => g.clientId) } },
      select: { clientId: true, name: true },
    });
    const names = new Map(clients.map((c) => [c.clientId, c.name || "Unnamed app"]));
    return grants.map((g) => ({
      id: g.id,
      clientName: names.get(g.clientId) ?? "Unknown app",
      organizationName: g.organization.name,
      userName: g.user.name,
      createdAt: g.createdAt,
      mine: g.userId === userId,
    }));
  }

  async revokeGrant(id: string, userId: string, organizationId: string, role: string): Promise<void> {
    const grant = await this.prisma.mcpGrant.findFirst({ where: { id, organizationId } });
    if (!grant) throw new NotFoundException("Connected app not found");
    if (grant.userId !== userId && role !== "owner") {
      throw new ForbiddenException("Only the workspace owner can disconnect another person's app");
    }
    const scope = { userId: grant.userId, clientId: grant.clientId };
    // The oauthConsent row is deliberately left in place. It grants nothing —
    // consent is forced on every authorize and this grant is the gate — but it
    // marks the registration as one a person once approved, which keeps the
    // nightly prune from deleting it and stranding the client on an
    // invalid_client page it cannot recover from.
    await this.prisma.$transaction([
      this.prisma.oauthAccessToken.deleteMany({ where: scope }),
      this.prisma.oauthRefreshToken.deleteMany({ where: scope }),
      this.prisma.mcpGrant.delete({ where: { id: grant.id } }),
    ]);
  }
}
