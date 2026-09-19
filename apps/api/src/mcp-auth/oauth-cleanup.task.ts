import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const UNUSED_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dynamic client registration is open, every refresh inserts a new token row,
 * and an abandoned consent page leaves a pending grant behind, so these tables
 * grow without an upper bound. This trims them nightly.
 */
@Injectable()
export class OAuthCleanupTask {
  private readonly logger = new Logger(OAuthCleanupTask.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Tokens first: a registration whose only remaining tokens are dead becomes
   * prunable in the same run. Each sweep handles its own failure so one broken
   * query does not skip the other.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async nightlyCleanup(): Promise<void> {
    await this.pruneExpiredTokens();
    await this.pruneUnusedClients();
    await this.pruneExpiredPendingGrants();
  }

  /** Drops abandoned registrations: never used, never approved, never granted. */
  async pruneUnusedClients(): Promise<void> {
    try {
      const granted = await this.prisma.mcpGrant.findMany({ select: { clientId: true }, distinct: ["clientId"] });
      const result = await this.prisma.oauthApplication.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - UNUSED_CLIENT_TTL_MS) },
          accessTokens: { none: {} },
          // A client the user once approved keeps its registration even after
          // Disconnect: clients cache their client_id, and deleting the row
          // strands them on Better Auth's invalid_client page with nothing to
          // act on. Reconnecting has to stay one sign-in away.
          consents: { none: {} },
          clientId: { notIn: granted.map((g) => g.clientId) },
        },
      });
      if (result.count > 0) this.logger.log(`Pruned ${result.count} unused OAuth client(s)`);
    } catch (err) {
      this.logger.error("Failed to prune OAuth clients", err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * Drops workspace choices whose consent code has expired. A user who opens
   * the consent page and walks away leaves one behind; it can never be
   * promoted once the code it names is dead.
   */
  async pruneExpiredPendingGrants(): Promise<void> {
    try {
      const result = await this.prisma.mcpPendingGrant.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) this.logger.log(`Deleted ${result.count} expired pending MCP grant(s)`);
    } catch (err) {
      this.logger.error(
        "Failed to delete expired pending MCP grants",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Drops token rows whose refresh token can no longer be redeemed. */
  async pruneExpiredTokens(): Promise<void> {
    try {
      const result = await this.prisma.oauthAccessToken.deleteMany({
        where: { refreshTokenExpiresAt: { lt: new Date() } },
      });
      if (result.count > 0) this.logger.log(`Deleted ${result.count} expired OAuth token row(s)`);
    } catch (err) {
      this.logger.error("Failed to delete expired OAuth tokens", err instanceof Error ? err.stack : String(err));
    }
  }
}
