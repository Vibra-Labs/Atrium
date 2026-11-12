import { randomUUID } from "node:crypto";
import type { PrismaService } from "../prisma/prisma.service";

export type PasskeyDeleteOutcome = "deleted" | "not_found" | "last_factor";

/** Verification identifier prefix marking a TOTP turn-off in progress for a user. */
export const TOTP_DISABLING: string = "two-factor-disabling:";
// Long enough for the disable request to finish; the after-hook clears it sooner.
const DISABLING_TTL_MS: number = 60_000;

type Tx = Pick<PrismaService, "$transaction">;

function lockUser(tx: Pick<PrismaService, "$queryRaw">, userId: string): Promise<unknown> {
  return tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
}

/**
 * Removes one of the user's passkeys, refusing the last factor of staff in a
 * workspace that requires 2FA. The user's row is locked first, so two
 * removals at the same moment run one after the other and the second sees
 * the first's result; checking in a hook and letting the plugin delete would
 * let both through. A TOTP turn-off in progress counts as TOTP being off.
 */
export async function deletePasskeyGuarded(
  prisma: Tx,
  userId: string,
  passkeyId: string,
  isStaffInRequiringWorkspace: (userId: string) => Promise<boolean>,
): Promise<PasskeyDeleteOutcome> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const owned: { id: string } | null = await tx.passkey.findFirst({ where: { id: passkeyId, userId }, select: { id: true } });
    if (!owned) return "not_found";
    const [passkeys, user, disabling] = await Promise.all([
      tx.passkey.count({ where: { userId } }),
      tx.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
      tx.verification.count({ where: { identifier: `${TOTP_DISABLING}${userId}`, expiresAt: { gt: new Date() } } }),
    ]);
    const totpStays: boolean = user?.twoFactorEnabled === true && disabling === 0;
    if (passkeys <= 1 && !totpStays && (await isStaffInRequiringWorkspace(userId))) {
      return "last_factor";
    }
    await tx.passkey.deleteMany({ where: { id: passkeyId, userId } });
    return "deleted";
  });
}

/**
 * Before TOTP is turned off for staff of a requiring workspace: under the same
 * lock as deletePasskeyGuarded, checks a passkey is left and marks the turn-off
 * as in progress, so a passkey removal racing it sees TOTP as already gone.
 */
export async function claimTotpDisable(prisma: Tx, userId: string): Promise<"ok" | "last_factor"> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    if ((await tx.passkey.count({ where: { userId } })) === 0) return "last_factor";
    await tx.verification.create({
      data: {
        id: randomUUID(),
        identifier: `${TOTP_DISABLING}${userId}`,
        value: "1",
        expiresAt: new Date(Date.now() + DISABLING_TTL_MS),
      },
    });
    return "ok";
  });
}

/** Clears the in-progress mark once the turn-off has finished or failed. */
export async function releaseTotpDisable(prisma: Pick<PrismaService, "verification">, userId: string): Promise<void> {
  await prisma.verification.deleteMany({ where: { identifier: `${TOTP_DISABLING}${userId}` } });
}
