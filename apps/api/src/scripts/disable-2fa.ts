/**
 * Operator reset for a user locked out of their second factor. Runs the
 * compiled build, like the server itself. From apps/api (in the API container:
 * /app/apps/api), after `bun run build` when running from a checkout:
 *
 *   bun run script:disable-2fa <email> --reason "<ticket or note>"
 *
 * See docs/runbooks/2fa-lockout.md.
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { CliModule } from "./cli.module";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { EmailRenderer } from "../mail/email-renderer";
import { resetSecondFactors } from "../two-factor/reset-second-factors";
import { sendSecurityAlert } from "../two-factor/security-alerts";
import { parseArgs, run } from "./disable-2fa-core";

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const app: INestApplicationContext = await NestFactory.createApplicationContext(CliModule, {
    logger: ["error", "warn"],
  });
  const logger: Logger = new Logger("disable-2fa");
  try {
    const prisma: PrismaService = app.get(PrismaService);
    const alertDeps = { prisma, mail: app.get(MailService), renderer: app.get(EmailRenderer), logger };
    return await run(
      {
        findUser: (email: string) => prisma.user.findUnique({ where: { email }, select: { id: true } }),
        reset: (userId: string) => resetSecondFactors(prisma, userId),
        alert: (userId: string) => sendSecurityAlert(alertDeps, userId, { kind: "two_factor_disabled", by: "operator" }),
        log: (line) => logger.log(JSON.stringify(line)),
        print: (text: string) => console.log(text),
      },
      parsed.email,
      parsed.reason,
    );
  } finally {
    await app.close();
  }
}

main()
  .then((code: number) => process.exit(code))
  .catch((err: unknown) => {
    console.error("disable-2fa failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
