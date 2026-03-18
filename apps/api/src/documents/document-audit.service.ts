import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";

@Injectable()
export class DocumentAuditService {
  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(DocumentAuditService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Log an audit event for a document. Fire-and-forget — never throws.
   */
  log(
    documentId: string,
    action: string,
    opts?: {
      userId?: string;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, unknown>;
    },
  ): void {
    this.prisma.documentAuditEvent
      .create({
        data: {
          documentId,
          action,
          userId: opts?.userId,
          ipAddress: opts?.ipAddress,
          userAgent: opts?.userAgent,
          metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
        },
      })
      .catch((err) => {
        this.logger.warn({ err, documentId, action }, "Failed to log audit event");
      });
  }

  /**
   * Get paginated audit trail for a document.
   */
  async getAuditTrail(documentId: string, page = 1, limit = 50) {
    const where = { documentId };
    const [data, total] = await Promise.all([
      this.prisma.documentAuditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.documentAuditEvent.count({ where }),
    ]);

    // Enrich with user names (batch query, not N+1)
    const userIds = [...new Set(data.filter((e) => e.userId).map((e) => e.userId!))];
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enriched = data.map((event) => ({
      ...event,
      metadata: event.metadata ? JSON.parse(event.metadata) : null,
      user: event.userId ? userMap.get(event.userId) || null : null,
    }));

    return paginatedResponse(enriched, total, page, limit);
  }
}
