import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { DocumentAuditService } from "./document-audit.service";

@Injectable()
export class DocumentReminderTask {
  private readonly logger = new Logger(DocumentReminderTask.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private auditService: DocumentAuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendReminders() {
    const now = new Date();

    // Find pending documents with reminders enabled
    const docs = await this.prisma.document.findMany({
      where: {
        status: "pending",
        reminderEnabled: true,
        sentAt: { not: null },
      },
      include: {
        responses: { select: { userId: true, action: true } },
      },
    });

    let sent = 0;
    for (const doc of docs) {
      // Check if reminder is due
      const lastReminder = doc.lastReminderAt || doc.sentAt;
      if (!lastReminder) continue;

      const intervalMs = doc.reminderIntervalDays * 24 * 60 * 60 * 1000;
      const nextReminderAt = new Date(lastReminder.getTime() + intervalMs);
      if (now < nextReminderAt) continue;

      // Don't send if expired
      if (doc.expiresAt && now > doc.expiresAt) continue;

      // Send reminder
      this.notifications.notifyDocumentReminder(doc.id);

      await this.prisma.document.update({
        where: { id: doc.id },
        data: { lastReminderAt: now },
      });

      this.auditService.log(doc.id, "reminder_sent");
      sent++;
    }

    if (sent > 0) {
      this.logger.log(`Sent ${sent} document reminder(s)`);
    }
  }
}
