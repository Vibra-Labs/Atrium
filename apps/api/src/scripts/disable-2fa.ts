// Standalone CLI: disables 2FA for a user identified by email.
// Usage: bun run script:disable-2fa <email>

import { PrismaClient } from "@atrium/database";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: bun run script:disable-2fa <email>");
    process.exit(2);
  }

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, twoFactorEnabled: true },
    });

    if (!user) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }

    if (!user.twoFactorEnabled) {
      console.log(`User ${email} does not have 2FA enabled — nothing to do.`);
      process.exit(0);
    }

    await prisma.twoFactor.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false },
    });

    console.log(`✓ Disabled 2FA for ${email}`);
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Failed to disable 2FA:", err);
  process.exit(1);
});
