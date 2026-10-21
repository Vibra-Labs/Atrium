import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const INVITATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Better Auth never purges its own tables, so expired sessions, spent
 * verification tokens and old invitations pile up. The deletes are idempotent,
 * so concurrent replicas running the same sweep are harmless.
 */
@Injectable()
export class AuthCleanupTask {
  private readonly logger = new Logger(AuthCleanupTask.name);

  constructor(private prisma: PrismaService) {}

  /** Each sweep handles its own failure so one broken query does not skip the others. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyCleanup(): Promise<void> {
    await this.sweep("expired sessions", () =>
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    );
    await this.sweep("expired verifications", () =>
      this.prisma.verification.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    );
    await this.sweep("old invitations", () =>
      this.prisma.invitation.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - INVITATION_RETENTION_MS) },
          OR: [{ status: { not: "pending" } }, { expiresAt: { lt: new Date() } }],
        },
      }),
    );
  }

  private async sweep(label: string, run: () => Promise<{ count: number }>): Promise<void> {
    try {
      const result = await run();
      if (result.count > 0) this.logger.log(`Deleted ${result.count} ${label}`);
    } catch (err) {
      this.logger.error(`Failed to delete ${label}`, err instanceof Error ? err.stack : String(err));
    }
  }
}
