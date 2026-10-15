import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const LAST_SEEN_INTERVAL_MS: number = 60 * 60 * 1000;
const MAX_TRACKED: number = 10_000;

/**
 * Records when a member last used the app in a workspace. Called on every
 * cookie-authenticated request, so writes are throttled in memory to one per
 * member per hour. With several API instances each may write once an hour,
 * which is harmless.
 */
@Injectable()
export class LastSeenTracker {
  private readonly logger = new Logger(LastSeenTracker.name);
  private readonly lastWrite = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  async touch(memberId: string, now: Date = new Date()): Promise<void> {
    const previous: number | undefined = this.lastWrite.get(memberId);
    if (previous !== undefined && now.getTime() - previous < LAST_SEEN_INTERVAL_MS) return;
    if (this.lastWrite.size >= MAX_TRACKED) this.lastWrite.clear();
    this.lastWrite.set(memberId, now.getTime());
    try {
      // updateMany: a member removed mid-session matches nothing instead of throwing.
      await this.prisma.member.updateMany({ where: { id: memberId }, data: { lastSeenAt: now } });
    } catch (err) {
      // Forget the stamp so the next visit tries again.
      this.lastWrite.delete(memberId);
      this.logger.warn(`Failed to record last seen for member ${memberId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
