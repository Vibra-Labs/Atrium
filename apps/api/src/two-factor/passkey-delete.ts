import type { PrismaService } from "../prisma/prisma.service";

export type PasskeyDeleteOutcome = "deleted" | "not_found" | "last_factor";

/**
 * Removes one of the user's passkeys, refusing the last factor of staff in a
 * workspace that requires 2FA. The user's row is locked first, so two
 * removals at the same moment run one after the other and the second sees
 * the first's result; checking in a hook and letting the plugin delete would
 * let both through.
 */
export async function deletePasskeyGuarded(
  prisma: Pick<PrismaService, "$transaction">,
  userId: string,
  passkeyId: string,
  isStaffInRequiringWorkspace: (userId: string) => Promise<boolean>,
): Promise<PasskeyDeleteOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
    const owned = await tx.passkey.findFirst({ where: { id: passkeyId, userId }, select: { id: true } });
    if (!owned) return "not_found";
    const [passkeys, user] = await Promise.all([
      tx.passkey.count({ where: { userId } }),
      tx.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    ]);
    if (passkeys <= 1 && user?.twoFactorEnabled !== true && (await isStaffInRequiringWorkspace(userId))) {
      return "last_factor";
    }
    await tx.passkey.deleteMany({ where: { id: passkeyId, userId } });
    return "deleted";
  });
}
