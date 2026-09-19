import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const UNUSED_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Dynamic client registration is open, so abandoned registrations are pruned. */
@Injectable()
export class OAuthCleanupTask {
  private readonly logger = new Logger(OAuthCleanupTask.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneUnusedClients(): Promise<void> {
    try {
      const granted = await this.prisma.mcpGrant.findMany({ select: { clientId: true }, distinct: ["clientId"] });
      const result = await this.prisma.oauthApplication.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - UNUSED_CLIENT_TTL_MS) },
          accessTokens: { none: {} },
          clientId: { notIn: granted.map((g) => g.clientId) },
        },
      });
      if (result.count > 0) this.logger.log(`Pruned ${result.count} unused OAuth client(s)`);
    } catch (err) {
      this.logger.error("Failed to prune OAuth clients", err instanceof Error ? err.stack : String(err));
    }
  }
}
