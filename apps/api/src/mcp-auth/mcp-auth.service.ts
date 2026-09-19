import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "../common";

const GRANT_ROLES: string[] = ["owner", "admin"];

export type ResolvedOAuthToken = Actor & { oauthClientId: string };

/** The parts of a pending authorization the consent screen is allowed to act on. */
export interface ConsentRequest {
  clientId: string;
  redirectURI: string;
}

/** What Better Auth's mcp plugin stores in the consent code's verification row. */
interface AuthorizationCodeValue {
  clientId?: unknown;
  redirectURI?: unknown;
  userId?: unknown;
  requireConsent?: unknown;
}

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
  private readonly logger = new Logger(McpAuthService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * The pending authorization a consent code stands for.
   *
   * The consent screen learns the client id from here, never from its own URL:
   * the two are otherwise unrelated, so a phishing link could name one client
   * in the query string while the code it carries authorizes another, and the
   * grant would be written for the client the URL chose. Reading both the
   * client and the destination out of the code's own row removes the gap.
   */
  async consentRequest(consentCode: string, userId: string): Promise<ConsentRequest> {
    const row = await this.prisma.verification.findFirst({ where: { identifier: consentCode } });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException(EXPIRED_CONSENT);
    }
    let value: AuthorizationCodeValue;
    try {
      value = JSON.parse(row.value) as AuthorizationCodeValue;
    } catch (err) {
      // Some other feature's verification row happens to share this identifier.
      this.logger.warn(
        `Consent code did not hold an authorization request: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new NotFoundException(EXPIRED_CONSENT);
    }
    if (
      value.userId !== userId ||
      value.requireConsent !== true ||
      typeof value.clientId !== "string" ||
      typeof value.redirectURI !== "string"
    ) {
      throw new NotFoundException(EXPIRED_CONSENT);
    }
    return { clientId: value.clientId, redirectURI: value.redirectURI };
  }

  /** OAuth access token → actor. Same role rule as API keys; expiry is checked here
   * because the OAuth plugin's own token lookup does not check it. */
  async resolve(token: string): Promise<ResolvedOAuthToken | null> {
    const row = await this.prisma.oauthAccessToken.findUnique({ where: { accessToken: token } });
    if (!row || !row.userId) return null;
    if (row.accessTokenExpiresAt.getTime() <= Date.now()) return null;

    const grant = await this.prisma.mcpGrant.findUnique({
      where: { userId_clientId: { userId: row.userId, clientId: row.clientId } },
      include: { user: true, organization: true },
    });
    if (!grant) return null;

    const member = await this.prisma.member.findFirst({
      where: { userId: row.userId, organizationId: grant.organizationId },
    });
    if (!member || !GRANT_ROLES.includes(member.role)) return null;

    return { user: grant.user, organization: grant.organization, member, oauthClientId: row.clientId };
  }

  async getClient(clientId: string): Promise<{ clientId: string; name: string }> {
    const app = await this.prisma.oauthApplication.findUnique({
      where: { clientId },
      select: { clientId: true, name: true },
    });
    if (!app) throw new NotFoundException("Unknown application");
    return app;
  }

  async adminOrganizations(userId: string): Promise<{ id: string; name: string }[]> {
    const memberships = await this.prisma.member.findMany({
      where: { userId, role: { in: GRANT_ROLES } },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return memberships.map((m) => m.organization);
  }

  async saveGrant(userId: string, clientId: string, organizationId: string): Promise<void> {
    const member = await this.prisma.member.findFirst({ where: { userId, organizationId } });
    if (!member || !GRANT_ROLES.includes(member.role)) {
      throw new ForbiddenException("You must be an owner or admin of that workspace");
    }
    await this.getClient(clientId);
    const existing = await this.prisma.mcpGrant.findUnique({
      where: { userId_clientId: { userId, clientId } },
      select: { organizationId: true },
    });
    // Access tokens carry no workspace of their own — they resolve through
    // this grant — so re-consenting into a different workspace would silently
    // re-point a session the user authorized for the old one. Those tokens are
    // signed out instead. The token for this consent is issued afterwards, so
    // it is unaffected.
    const movedWorkspace: boolean =
      existing !== null && existing.organizationId !== organizationId;
    await this.prisma.$transaction([
      ...(movedWorkspace
        ? [this.prisma.oauthAccessToken.deleteMany({ where: { userId, clientId } })]
        : []),
      this.prisma.mcpGrant.upsert({
        where: { userId_clientId: { userId, clientId } },
        create: { userId, clientId, organizationId },
        update: { organizationId },
      }),
    ]);
  }

  /** Admins see their own grants in this workspace; the owner sees everyone's. */
  async listGrants(userId: string, organizationId: string, role: string): Promise<GrantSummary[]> {
    const grants = await this.prisma.mcpGrant.findMany({
      where: { organizationId, ...(role === "owner" ? {} : { userId }) },
      include: { user: { select: { name: true } }, organization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const apps = await this.prisma.oauthApplication.findMany({
      where: { clientId: { in: grants.map((g) => g.clientId) } },
      select: { clientId: true, name: true },
    });
    const names = new Map(apps.map((a) => [a.clientId, a.name]));
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
      this.prisma.mcpGrant.delete({ where: { id: grant.id } }),
    ]);
  }
}
