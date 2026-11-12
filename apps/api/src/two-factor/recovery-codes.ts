import { symmetricDecrypt } from "better-auth/crypto";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * How many recovery codes the user has left, or null when 2FA is off or the
 * codes cannot be read. Codes are stored encrypted with BETTER_AUTH_SECRET
 * (`storeBackupCodes: "encrypted"`; no secret rotation configured).
 */
export async function countRecoveryCodes(
  prisma: Pick<PrismaService, "twoFactor">,
  secret: string,
  userId: string,
): Promise<number | null> {
  const row = await prisma.twoFactor.findUnique({ where: { userId }, select: { backupCodes: true } });
  if (!row) return null;
  const codes: unknown = JSON.parse(await symmetricDecrypt({ key: secret, data: row.backupCodes }));
  return Array.isArray(codes) ? codes.length : null;
}
