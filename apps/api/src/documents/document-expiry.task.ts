import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentAuditService } from "./document-audit.service";

@Injectable()
export class DocumentExpiryTask {
  private readonly logger = new Logger(DocumentExpiryTask.name);

  constructor(
    private prisma: PrismaService,
    private auditService: DocumentAuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireDocuments() {
    const now = new Date();

    const expiredDocs = await this.prisma.document.findMany({
      where: {
        status: "pending",
        expiresAt: { lt: now },
      },
      select: { id: true },
    });

    if (expiredDocs.length === 0) return;

    await this.prisma.document.updateMany({
      where: {
        id: { in: expiredDocs.map((d) => d.id) },
      },
      data: { status: "expired" },
    });

    for (const doc of expiredDocs) {
      this.auditService.log(doc.id, "expired");
    }

    this.logger.log(`Marked ${expiredDocs.length} document(s) as expired`);
  }
}
