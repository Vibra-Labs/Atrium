import type { PrismaService } from "../prisma/prisma.service";

export interface SecondFactors {
  totp: boolean;
  passkeys: number;
}

/** The second factors a user has: TOTP on or off, and how many passkeys. */
export async function secondFactorsOf(
  prisma: Pick<PrismaService, "user" | "passkey">,
  userId: string,
): Promise<SecondFactors> {
  const [user, passkeys] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    prisma.passkey.count({ where: { userId } }),
  ]);
  return { totp: user?.twoFactorEnabled === true, passkeys };
}
