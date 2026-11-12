import type { PrismaService } from "../prisma/prisma.service";

/**
 * Removes a user's second factors and signs them out everywhere: TOTP and
 * recovery codes, every session, and every trusted-device record (the trust
 * cookie is checked against these rows). Passkeys join this in PR 2.
 * Shared by the owner/admin reset and the operator command.
 */
export async function resetSecondFactors(
  prisma: Pick<PrismaService, "$transaction">,
  userId: string,
): Promise<{ hadTwoFactor: boolean }> {
  return prisma.$transaction(async (tx) => {
    const removed = await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.verification.deleteMany({ where: { identifier: { startsWith: "trust-device-" }, value: userId } });
    return { hadTwoFactor: removed.count > 0 };
  });
}
