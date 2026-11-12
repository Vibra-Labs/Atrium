import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ROLES } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { isPrivilegedRole } from "../common/helpers/privileged-role";
import { hasSecondFactor } from "./second-factor";
import { isStaffInRequiringWorkspace } from "./staff-requirement";
import { countRecoveryCodes } from "./recovery-codes";
import { resetSecondFactors } from "./reset-second-factors";
import { AuthService } from "../auth/auth.service";
import { SessionCache } from "../auth/session-cache";

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

export interface ResetInput {
  actorId: string;
  actorRole: string;
  organizationId: string;
  targetUserId: string;
  /** The actor's own TOTP or recovery code, required when the actor has 2FA. */
  code?: string;
  /** The actor's request headers, so Better Auth can check the code against their session. */
  headers: Headers;
  /** Hosted cloud (support exists) vs self-hosted (the server operator). */
  hosted: boolean;
}

/** The two Better Auth endpoints used to confirm the actor; `auth`'s plugin-less type leaves them out. */
type VerifyCode = (input: { body: { code: string }; headers: Headers }) => Promise<unknown>;

/** Recovery codes look like "abcde-12345"; authenticator codes are digits. */
const RECOVERY_CODE_SHAPE: RegExp = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

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
    private authService: AuthService,
    private sessionCache: SessionCache,
  ) {}

  async getStatus(input: StatusInput): Promise<TwoFactorStatus> {
    const { userId, organizationId, role } = input;
    const [user, codesLeft, settings, ownerCount, staffInRequiring] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
      this.countCodes(userId),
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
      recoveryCodesLeft: enabled ? codesLeft : null,
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

  /**
   * An owner or admin removes a member's second factors: owners for anyone,
   * admins for anyone but owners. Refused when the member also belongs to
   * another workspace, which this one must not be able to weaken.
   */
  async resetForMember(input: ResetInput): Promise<{ success: true }> {
    const { actorId, organizationId, targetUserId } = input;
    if (actorId === targetUserId) {
      throw new BadRequestException("Use Settings → Security to change your own two-factor.");
    }
    const [target, otherWorkspace] = await Promise.all([
      this.prisma.member.findFirst({ where: { userId: targetUserId, organizationId }, select: { role: true } }),
      this.prisma.member.findFirst({
        where: { userId: targetUserId, organizationId: { not: organizationId } },
        select: { id: true },
      }),
    ]);
    if (!target) throw new NotFoundException("Member not found");
    if (target.role === ROLES.OWNER && input.actorRole !== ROLES.OWNER) {
      throw new ForbiddenException("Only an owner can reset another owner's two-factor.");
    }
    if (otherWorkspace) {
      throw new ConflictException(
        "This person also belongs to another workspace, so their two-factor can't be reset from here. " +
          `They can use a recovery code, ${input.hosted ? "or contact support." : "or ask whoever runs this server."}`,
      );
    }
    await this.confirmActor(actorId, input.code, input.headers);

    await resetSecondFactors(this.prisma, targetUserId);
    this.sessionCache.deleteUser(targetUserId);
    await this.authService.sendAlert(targetUserId, { kind: "two_factor_disabled", by: "admin" });
    this.logger.log(
      JSON.stringify({ event: "two_factor.reset_by_admin", actorId, targetUserId, organizationId }),
    );
    return { success: true };
  }

  /** An actor who has 2FA proves it again before weakening someone else's account. */
  private async confirmActor(actorId: string, code: string | undefined, headers: Headers): Promise<void> {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { twoFactorEnabled: true } });
    if (!hasSecondFactor({ twoFactorEnabled: actor?.twoFactorEnabled })) return;
    const refusal: string = "Enter a code from your authenticator app to confirm.";
    if (!code) throw new ForbiddenException(refusal);
    const api = this.authService.auth.api as unknown as { verifyTOTP: VerifyCode; verifyBackupCode: VerifyCode };
    const verify: VerifyCode = RECOVERY_CODE_SHAPE.test(code) ? api.verifyBackupCode : api.verifyTOTP;
    try {
      await verify({ body: { code }, headers });
    } catch (err) {
      this.logger.warn(`2FA reset confirmation failed for ${actorId}: ${err instanceof Error ? err.message : String(err)}`);
      throw new ForbiddenException(refusal);
    }
  }

  /** Whether the user is an owner or admin of any workspace that requires 2FA. */
  async isStaffInRequiringWorkspace(userId: string): Promise<boolean> {
    return isStaffInRequiringWorkspace(this.prisma, userId);
  }

  private async countCodes(userId: string): Promise<number | null> {
    try {
      return await countRecoveryCodes(this.prisma, this.config.getOrThrow("BETTER_AUTH_SECRET"), userId);
    } catch (err) {
      this.logger.error(`Could not read recovery codes: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
