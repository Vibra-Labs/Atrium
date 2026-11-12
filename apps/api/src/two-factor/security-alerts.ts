import type { Logger } from "@nestjs/common";
import { SecurityAlertEmail } from "@atrium/email";
import type { PrismaService } from "../prisma/prisma.service";
import type { MailService } from "../mail/mail.service";
import type { EmailRenderer } from "../mail/email-renderer";

export type SecurityAlert =
  | { kind: "two_factor_disabled"; by: "you" | "admin" | "operator" }
  | { kind: "recovery_code_used"; remaining: number }
  /** signedOut: whether every other device was signed out with the change. */
  | { kind: "password_changed"; signedOut: boolean };

export interface SecurityAlertDeps {
  prisma: Pick<PrismaService, "user" | "member">;
  mail: Pick<MailService, "send">;
  renderer: Pick<EmailRenderer, "render">;
  logger: Pick<Logger, "error">;
}

/** At or below this many codes left, the email tells the user to make new ones. */
const LOW_CODES: number = 3;

const DISABLED_BY: Record<"you" | "admin" | "operator", string> = {
  you: "You turned off two-factor authentication for your account.",
  admin: "A workspace owner or admin turned off two-factor authentication for your account and signed you out everywhere.",
  operator: "Support turned off two-factor authentication for your account and signed you out everywhere.",
};

function compose(alert: SecurityAlert, when: string): { subject: string; paragraphs: string[] } {
  switch (alert.kind) {
    case "two_factor_disabled":
      return {
        subject: "Two-factor authentication was turned off",
        paragraphs: [`${DISABLED_BY[alert.by]} (${when})`, "You can turn it back on in Settings → Security."],
      };
    case "recovery_code_used": {
      const left: string = `You have ${alert.remaining} recovery code${alert.remaining === 1 ? "" : "s"} left.`;
      return {
        subject: "A recovery code was used to sign in",
        paragraphs: [
          `Someone signed in to your account with a recovery code (${when}).`,
          alert.remaining <= LOW_CODES ? `${left} Make new ones in Settings → Security.` : left,
        ],
      };
    }
    case "password_changed":
      return {
        subject: "Your password was changed",
        paragraphs: [
          alert.signedOut
            ? `The password for your account was changed (${when}), and every device was signed out.`
            : `The password for your account was changed (${when}). If this wasn't you, reset your password now.`,
        ],
      };
  }
}

/** Emails the user about a change to their account's security. Never throws: an alert must not fail the action. */
export async function sendSecurityAlert(deps: SecurityAlertDeps, userId: string, alert: SecurityAlert): Promise<void> {
  try {
    const [user, member] = await Promise.all([
      deps.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      deps.prisma.member.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      }),
    ]);
    if (!user) return;
    const when: string = new Date().toUTCString();
    const { subject, paragraphs } = compose(alert, when);
    const html: string = await deps.renderer.render(SecurityAlertEmail({ heading: subject, paragraphs }));
    await deps.mail.send(user.email, subject, html, member?.organizationId);
  } catch (err) {
    deps.logger.error(`Security alert (${alert.kind}) for ${userId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
