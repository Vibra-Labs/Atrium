import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { verifyPassword } from "better-auth/crypto";
import { DELETED_USER_SENTINEL } from "@atrium/shared";
import type { DeletionInfo } from "@atrium/shared";
import type { StorageProvider } from "../files/storage/storage.interface";
import { STORAGE_PROVIDER } from "../files/storage/storage.interface";

@Injectable()
export class AccountService {
  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private storage: StorageProvider,
    @InjectPinoLogger(AccountService.name) private readonly logger: PinoLogger,
  ) {}

  async getDeletionInfo(userId: string): Promise<DeletionInfo> {
    const memberships = await this.prisma.member.findMany({
      where: { userId, role: "owner" },
      include: { organization: { select: { id: true, name: true } } },
    });

    if (memberships.length === 0) {
      return { ownedOrganizations: [] };
    }

    const orgIds = memberships.map((m) => m.organizationId);

    const [memberCounts, ownerCounts] = await Promise.all([
      this.prisma.member.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: orgIds } },
        _count: true,
      }),
      this.prisma.member.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: orgIds }, role: "owner" },
        _count: true,
      }),
    ]);

    const memberCountMap = new Map(memberCounts.map((g) => [g.organizationId, g._count]));
    const ownerCountMap = new Map(ownerCounts.map((g) => [g.organizationId, g._count]));

    return {
      ownedOrganizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        isSoleOwner: (ownerCountMap.get(m.organizationId) ?? 0) === 1,
        memberCount: memberCountMap.get(m.organizationId) ?? 0,
      })),
    };
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    // Verify password before proceeding
    const account = await this.prisma.account.findFirst({
      where: { userId, providerId: "credential" },
      select: { password: true },
    });

    if (!account?.password) {
      throw new UnauthorizedException("Password verification failed.");
    }

    const valid = await verifyPassword({
      hash: account.password,
      password,
    });

    if (!valid) {
      throw new UnauthorizedException("Password verification failed.");
    }

    const memberships = await this.prisma.member.findMany({
      where: { userId },
      select: { organizationId: true, role: true },
    });
    const allOrgIds = memberships.map((m) => m.organizationId);
    const ownerOrgIds = memberships.filter((m) => m.role === "owner").map((m) => m.organizationId);

    let orgsToDelete: string[] = [];
    if (ownerOrgIds.length > 0) {
      const otherOwnerCounts = await this.prisma.member.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: ownerOrgIds }, role: "owner", userId: { not: userId } },
        _count: true,
      });
      const otherOwnerMap = new Map(otherOwnerCounts.map((g) => [g.organizationId, g._count]));
      orgsToDelete = ownerOrgIds.filter((id) => !otherOwnerMap.has(id));
    }
    const deleteSet = new Set(orgsToDelete);
    const remainingOrgIds = allOrgIds.filter((id) => !deleteSet.has(id));

    // Collect storage keys before deletion so we can purge blobs after the transaction
    let storageKeys: string[] = [];
    if (orgsToDelete.length > 0) {
      const files = await this.prisma.file.findMany({
        where: { organizationId: { in: orgsToDelete }, type: "UPLOAD", storageKey: { not: null } },
        select: { storageKey: true },
      });
      storageKeys = files.map((f) => f.storageKey).filter((k): k is string => k !== null);
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete orgs where user is sole owner.
      // FK cascades handle: Project -> (File, ProjectUpdate, Task, ProjectNote),
      // Invoice -> InvoiceLineItem, Organization -> (Member, Invitation, SystemSettings)
      for (const orgId of orgsToDelete) {
        await Promise.all([
          tx.invoice.deleteMany({ where: { organizationId: orgId } }),
          tx.project.deleteMany({ where: { organizationId: orgId } }),
          tx.projectStatus.deleteMany({ where: { organizationId: orgId } }),
          tx.clientProfile.deleteMany({ where: { organizationId: orgId } }),
          tx.branding.deleteMany({ where: { organizationId: orgId } }),
          tx.subscription.deleteMany({ where: { organizationId: orgId } }),
          tx.notification.deleteMany({ where: { organizationId: orgId } }),
          tx.pushSubscription.deleteMany({ where: { organizationId: orgId } }),
        ]);
        await tx.organization.delete({ where: { id: orgId } });
      }

      // Anonymize authored content in orgs the user is leaving (not deleting)
      if (remainingOrgIds.length > 0) {
        await Promise.all([
          tx.projectUpdate.updateMany({
            where: { authorId: userId, organizationId: { in: remainingOrgIds } },
            data: { authorId: DELETED_USER_SENTINEL },
          }),
          tx.projectNote.updateMany({
            where: { authorId: userId, organizationId: { in: remainingOrgIds } },
            data: { authorId: DELETED_USER_SENTINEL },
          }),
          tx.file.updateMany({
            where: { uploadedById: userId, organizationId: { in: remainingOrgIds } },
            data: { uploadedById: DELETED_USER_SENTINEL },
          }),
        ]);
      }

      // Clean up user-level data
      await Promise.all([
        tx.clientProfile.deleteMany({ where: { userId } }),
        tx.invitation.deleteMany({ where: { inviterId: userId } }),
        tx.notification.deleteMany({ where: { userId } }),
        tx.pushSubscription.deleteMany({ where: { userId } }),
      ]);

      // Delete the user row (cascades Session, Account, Member, ProjectClient)
      await tx.user.delete({ where: { id: userId } });
    });

    // Purge file blobs from storage (fire-and-forget, best-effort)
    if (storageKeys.length > 0) {
      Promise.allSettled(storageKeys.map((key) => this.storage.delete(key)))
        .then((results) => {
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed > 0) {
            this.logger.warn({ failed, total: storageKeys.length }, "Some file blobs could not be purged");
          }
        });
    }

    this.logger.info({ userId, orgsDeleted: orgsToDelete }, "Account deleted");
  }
}
