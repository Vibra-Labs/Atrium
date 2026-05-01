import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";

const STAFF_ROLES = new Set(["owner", "admin"]);

export interface TwoFactorStatus {
  enabled: boolean;
  requiredByOrg: boolean;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(TwoFactorService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getStatus(userId: string, organizationId: string): Promise<TwoFactorStatus> {
    const [user, settings] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      }),
      this.prisma.systemSettings.findUnique({
        where: { organizationId },
        select: { requireTwoFactor: true },
      }),
    ]);

    return {
      enabled: user?.twoFactorEnabled ?? false,
      requiredByOrg: settings?.requireTwoFactor ?? false,
    };
  }

  async disableForUser(
    actorUserId: string,
    targetUserId: string,
    organizationId: string,
  ): Promise<{ success: true }> {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException(
        "Use the self-service disable flow for your own account.",
      );
    }

    const [actorMember, targetMember] = await Promise.all([
      this.prisma.member.findFirst({
        where: { userId: actorUserId, organizationId },
        select: { role: true },
      }),
      this.prisma.member.findFirst({
        where: { userId: targetUserId, organizationId },
        select: { role: true },
      }),
    ]);

    if (!targetMember) {
      throw new NotFoundException("Target user is not a member of this organization");
    }
    if (!actorMember || !STAFF_ROLES.has(actorMember.role)) {
      throw new ForbiddenException("Only owners and admins can disable 2FA for other users");
    }

    await this.prisma.twoFactor.deleteMany({ where: { userId: targetUserId } });
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { twoFactorEnabled: false },
    });

    this.logger.info(
      {
        event: "two_factor.admin_disabled",
        actorId: actorUserId,
        targetUserId,
        organizationId,
      },
      "Admin disabled 2FA for another user",
    );

    return { success: true };
  }
}
