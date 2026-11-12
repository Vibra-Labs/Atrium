import type { PrismaService } from "../prisma/prisma.service";

export interface ResetResult {
  hadTwoFactor: boolean;
  passkeysRemoved: number;
  /** Passkeys still on the account (non-zero only when passkeys were kept). */
  passkeysLeft: number;
}

/**
 * Removes a user's second factors and signs them out everywhere: TOTP and
 * recovery codes, every session, every trusted-device record (the trust
 * cookie is checked against these rows), and passkeys when asked.
 * Shared by the owner/admin reset and the operator command.
 */
export async function resetSecondFactors(
  prisma: Pick<PrismaService, "$transaction">,
  userId: string,
  opts: { passkeys: boolean },
): Promise<ResetResult> {
  return prisma.$transaction(async (tx) => {
    const removed = await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.verification.deleteMany({ where: { identifier: { startsWith: "trust-device-" }, value: userId } });
    const passkeysRemoved: number = opts.passkeys ? (await tx.passkey.deleteMany({ where: { userId } })).count : 0;
    const passkeysLeft: number = opts.passkeys ? 0 : await tx.passkey.count({ where: { userId } });
    return { hadTwoFactor: removed.count > 0, passkeysRemoved, passkeysLeft };
  });
}
