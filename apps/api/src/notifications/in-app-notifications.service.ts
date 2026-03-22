import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";

interface CreateNotificationData {
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}

@Injectable()
export class InAppNotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateNotificationData) {
    return this.prisma.notification.create({ data });
  }

  async createMany(notifications: CreateNotificationData[]) {
    if (notifications.length === 0) return;
    await this.prisma.notification.createMany({ data: notifications });
  }

  async findByUser(userId: string, orgId: string, page = 1, limit = 10) {
    const where = { userId, organizationId: orgId };

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginatedResponse(notifications, total, page, limit);
  }

  async unreadCount(userId: string, orgId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, organizationId: orgId, read: false },
    });
  }

  async markRead(id: string, userId: string, orgId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, organizationId: orgId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string, orgId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, organizationId: orgId, read: false },
      data: { read: true },
    });
  }
}
