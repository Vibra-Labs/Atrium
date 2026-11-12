import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { symmetricDecrypt } from "better-auth/crypto";
import { ROLES } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { isPrivilegedRole } from "../common/helpers/privileged-role";
import { hasSecondFactor } from "./second-factor";
import { isStaffInRequiringWorkspace } from "./staff-requirement";

export interface TwoFactorStatus {
  enabled: boolean;
  /** This session has not passed the user's second factor yet. */
  pending: boolean;
  /** Staff in a workspace that requires 2FA, with no factor yet. */
  enrollmentRequired: boolean;
  workspaceRequires: boolean;
  isStaff: boolean;
  isOwner: boolean;
  /** null when 2FA is off. */
  recoveryCodesLeft: number | null;
  /** The only owner of the active workspace. */
  soloOwner: boolean;
  /** False while removing 2FA would leave a requiring workspace's staff member with no factor. */
  canTurnOff: boolean;
}

export interface StatusInput {
  userId: string;
  secondFactor: string | null;
  organizationId: string | undefined;
  role: string | undefined;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async getStatus(input: StatusInput): Promise<TwoFactorStatus> {
    const { userId, organizationId, role } = input;
    const [user, twoFactor, settings, ownerCount, staffInRequiring] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
      this.prisma.twoFactor.findUnique({ where: { userId }, select: { backupCodes: true } }),
      organizationId
        ? this.prisma.systemSettings.findUnique({ where: { organizationId }, select: { requireTwoFactor: true } })
        : Promise.resolve(null),
      organizationId && role === ROLES.OWNER
        ? this.prisma.member.count({ where: { organizationId, role: ROLES.OWNER } })
        : Promise.resolve(0),
      this.isStaffInRequiringWorkspace(userId),
    ]);

    const enabled: boolean = hasSecondFactor({ twoFactorEnabled: user?.twoFactorEnabled });
    const isStaff: boolean = isPrivilegedRole(role);
    const workspaceRequires: boolean = settings?.requireTwoFactor === true;
    return {
      enabled,
      pending: enabled && input.secondFactor === null,
      enrollmentRequired: workspaceRequires && isStaff && !enabled,
      workspaceRequires,
      isStaff,
      isOwner: role === ROLES.OWNER,
      recoveryCodesLeft: enabled && twoFactor ? await this.countCodes(twoFactor.backupCodes) : null,
      soloOwner: role === ROLES.OWNER && ownerCount === 1,
      canTurnOff: !(enabled && staffInRequiring),
    };
  }

  /** Owner-only. Turning it on needs the owner's own 2FA first, so nobody is locked into setup by surprise. */
  async setRequirement(userId: string, organizationId: string, required: boolean): Promise<{ required: boolean }> {
    if (required) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
      if (!hasSecondFactor({ twoFactorEnabled: user?.twoFactorEnabled })) {
        throw new BadRequestException("Set up two-factor for your own account first.");
      }
    }
    await this.prisma.systemSettings.update({ where: { organizationId }, data: { requireTwoFactor: required } });
    this.logger.log(
      JSON.stringify({ event: "two_factor.requirement_changed", organizationId, userId, required }),
    );
    return { required };
  }

  /** Whether the user is an owner or admin of any workspace that requires 2FA. */
  async isStaffInRequiringWorkspace(userId: string): Promise<boolean> {
    return isStaffInRequiringWorkspace(this.prisma, userId);
  }

  private async countCodes(stored: string): Promise<number | null> {
    try {
      const json: string = await symmetricDecrypt({ key: this.config.getOrThrow("BETTER_AUTH_SECRET"), data: stored });
      const codes: unknown = JSON.parse(json);
      return Array.isArray(codes) ? codes.length : null;
    } catch (err) {
      this.logger.error(`Could not read recovery codes: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
