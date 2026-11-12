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
import { hasSecondFactor, passkeyProofIsRecent } from "./second-factor";
import { secondFactorsOf } from "./second-factors-of";
import type { SecondFactors } from "./second-factors-of";
import { isStaffAnywhere, isStaffInRequiringWorkspace } from "./staff-requirement";
import { passkeysEnabled } from "../common/helpers/passkeys";
import { countRecoveryCodes } from "./recovery-codes";
import { resetSecondFactors } from "./reset-second-factors";
import { verifyOwnCode } from "./verify-own-code";
import type { CodeApi } from "./verify-own-code";
import { AuthService } from "../auth/auth.service";
import { SessionCache } from "../auth/session-cache";

export interface TwoFactorStatus {
  /** Has any second factor (authenticator app or passkey). */
  enabled: boolean;
  /** Authenticator app (TOTP) is on. */
  totpEnabled: boolean;
  passkeyCount: number;
  /** Passkeys work on this install and the user may add them (staff), or already has some. */
  passkeysOffered: boolean;
  /** False when removing the last passkey would leave requiring-workspace staff with no factor. */
  canRemoveLastPasskey: boolean;
  /** This session has not passed the user's second factor yet. */
  pending: boolean;
  /** Staff in a workspace that requires 2FA, with no factor yet. */
  enrollmentRequired: boolean;
  workspaceRequires: boolean;
  isStaff: boolean;
  isOwner: boolean;
  /** null when the authenticator app is off. */
  recoveryCodesLeft: number | null;
  /** The only owner of the active workspace. */
  soloOwner: boolean;
  /** False when turning the authenticator app off would leave requiring-workspace staff with no factor. */
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
  /** The actor's session: a passkey sign-in in the last few minutes counts as confirmation. */
  session: { secondFactor?: string | null; createdAt: Date };
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
    private authService: AuthService,
    private sessionCache: SessionCache,
  ) {}

  async getStatus(input: StatusInput): Promise<TwoFactorStatus> {
    const { userId, organizationId, role } = input;
    const [factors, codesLeft, settings, ownerCount, staffInRequiring, staffAnywhere] = await Promise.all([
      secondFactorsOf(this.prisma, userId),
      this.countCodes(userId),
      organizationId
        ? this.prisma.systemSettings.findUnique({ where: { organizationId }, select: { requireTwoFactor: true } })
        : Promise.resolve(null),
      organizationId && role === ROLES.OWNER
        ? this.prisma.member.count({ where: { organizationId, role: ROLES.OWNER } })
        : Promise.resolve(0),
      this.isStaffInRequiringWorkspace(userId),
      isStaffAnywhere(this.prisma, userId),
    ]);

    const enabled: boolean = hasSecondFactor({ twoFactorEnabled: factors.totp, hasPasskey: factors.passkeys > 0 });
    const isStaff: boolean = isPrivilegedRole(role);
    const workspaceRequires: boolean = settings?.requireTwoFactor === true;
    return {
      enabled,
      totpEnabled: factors.totp,
      passkeyCount: factors.passkeys,
      passkeysOffered: passkeysEnabled(this.config) && (staffAnywhere || factors.passkeys > 0),
      canRemoveLastPasskey: !(staffInRequiring && !factors.totp && factors.passkeys <= 1),
      pending: enabled && input.secondFactor === null,
      enrollmentRequired: workspaceRequires && isStaff && !enabled,
      workspaceRequires,
      isStaff,
      isOwner: role === ROLES.OWNER,
      recoveryCodesLeft: factors.totp ? codesLeft : null,
      soloOwner: role === ROLES.OWNER && ownerCount === 1,
      canTurnOff: !(factors.totp && staffInRequiring && factors.passkeys === 0),
    };
  }

  /** Owner-only. Turning it on needs the owner's own 2FA first, so nobody is locked into setup by surprise. */
  async setRequirement(userId: string, organizationId: string, required: boolean): Promise<{ required: boolean }> {
    if (required) {
      const factors: SecondFactors = await secondFactorsOf(this.prisma, userId);
      if (!hasSecondFactor({ twoFactorEnabled: factors.totp, hasPasskey: factors.passkeys > 0 })) {
        throw new BadRequestException("Set up two-factor for your own account first.");
      }
    }
    await this.prisma.systemSettings.upsert({
      where: { organizationId },
      update: { requireTwoFactor: required },
      create: { organizationId, requireTwoFactor: required },
    });
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
    await this.confirmActor(actorId, input.code, input.headers, input.session);

    await resetSecondFactors(this.prisma, targetUserId, { passkeys: true });
    this.sessionCache.deleteUser(targetUserId);
    await this.authService.sendAlert(targetUserId, { kind: "two_factor_disabled", by: "admin", passkeys: true });
    this.logger.log(
      JSON.stringify({ event: "two_factor.reset_by_admin", actorId, targetUserId, organizationId }),
    );
    return { success: true };
  }

  /**
   * An actor who has a second factor proves it again before weakening someone
   * else's account: a current code (TOTP or recovery), or a passkey sign-in
   * from the last few minutes (the web app runs the ceremony just before).
   */
  private async confirmActor(
    actorId: string,
    code: string | undefined,
    headers: Headers,
    session: { secondFactor?: string | null; createdAt: Date },
  ): Promise<void> {
    const factors: SecondFactors = await secondFactorsOf(this.prisma, actorId);
    if (!hasSecondFactor({ twoFactorEnabled: factors.totp, hasPasskey: factors.passkeys > 0 })) return;
    if (factors.passkeys > 0 && passkeyProofIsRecent(session, Date.now())) return;
    const api: CodeApi = this.authService.auth.api as unknown as CodeApi;
    if (!factors.totp || !code || !(await verifyOwnCode(api, code.trim(), headers))) {
      throw new ForbiddenException("Confirm with a code from your authenticator app, or with your passkey.");
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
