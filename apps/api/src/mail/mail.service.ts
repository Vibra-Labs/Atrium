import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { Resend } from "resend";
import * as nodemailer from "nodemailer";
import { SettingsService } from "../settings/settings.service";

interface SmtpConfig {
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  secure: boolean;
}

const MAX_CONCURRENT_SENDS = 2;

/** Runs at most `max` tasks at once; the rest wait their turn in order. */
function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

@Injectable()
export class MailService {
  private readonly limitSend = createLimiter(MAX_CONCURRENT_SENDS);
  private resend: Resend | null;
  private from: string;
  private static readonly SMTP_CACHE_TTL_MS = 5 * 60 * 1000;
  private smtpTransporters = new Map<string, { transporter: nodemailer.Transporter; createdAt: number }>();

  constructor(
    private config: ConfigService,
    private settingsService: SettingsService,
    @InjectPinoLogger(MailService.name) private readonly logger: PinoLogger,
  ) {
    // Initialize default Resend client from env vars (fallback)
    const apiKey = this.config.get("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = this.config.get("EMAIL_FROM", "noreply@atrium.local");
  }

  private getSmtpTransporter(smtp: SmtpConfig, organizationId?: string): nodemailer.Transporter {
    const key = `${organizationId ?? "default"}:${smtp.host}:${smtp.port}:${smtp.user}`;
    const cached = this.smtpTransporters.get(key);
    if (cached && Date.now() - cached.createdAt < MailService.SMTP_CACHE_TTL_MS) {
      return cached.transporter;
    }
    if (cached) {
      this.smtpTransporters.delete(key);
    }
    const transporter = nodemailer.createTransport({
      host: smtp.host ?? undefined,
      port: smtp.port,
      secure: smtp.secure,
      auth:
        smtp.user && smtp.pass
          ? { user: smtp.user, pass: smtp.pass }
          : undefined,
    });
    this.smtpTransporters.set(key, { transporter, createdAt: Date.now() });
    return transporter;
  }

  /** Sends are capped at MAX_CONCURRENT_SENDS at a time so a burst stays under provider rate limits. */
  send(
    to: string,
    subject: string,
    html: string,
    organizationId?: string,
  ): Promise<{ sent: boolean; viaOrgConfig: boolean }> {
    return this.limitSend(() => this.deliver(to, subject, html, organizationId));
  }

  private async deliver(
    to: string,
    subject: string,
    html: string,
    organizationId?: string,
  ): Promise<{ sent: boolean; viaOrgConfig: boolean }> {
    if (organizationId) {
      try {
        const emailConfig = await this.settingsService.getEffectiveEmailConfig(organizationId);

        if (
          emailConfig.isOrgConfigured &&
          emailConfig.provider === "resend" &&
          emailConfig.apiKey
        ) {
          const resend = new Resend(emailConfig.apiKey);
          const { error } = await resend.emails.send({
            from: emailConfig.from,
            to,
            subject,
            html,
          });
          if (error) {
            this.logResendError(error, to, subject, "DB-configured Resend failed, falling back to env vars");
          } else {
            this.logger.info({ to, subject }, "Email sent via DB-configured Resend");
            return { sent: true, viaOrgConfig: true };
          }
        }

        if (
          emailConfig.isOrgConfigured &&
          emailConfig.provider === "smtp" &&
          emailConfig.smtp
        ) {
          const transporter = this.getSmtpTransporter(emailConfig.smtp, organizationId);
          await transporter.sendMail({
            from: emailConfig.from,
            to,
            subject,
            html,
          });
          this.logger.info({ to, subject }, "Email sent via DB-configured SMTP");
          return { sent: true, viaOrgConfig: true };
        }
      } catch (err) {
        this.logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to send via DB email config, falling back to env vars",
        );
      }
    }

    if (!this.resend) {
      this.logger.info({ to, subject }, "Email not sent (no email provider configured)");
      return { sent: false, viaOrgConfig: false };
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });
    if (error) {
      this.logResendError(error, to, subject, "Email not sent: env-var Resend failed");
      return { sent: false, viaOrgConfig: false };
    }
    this.logger.info({ to, subject }, "Email sent via env-var Resend");
    return { sent: true, viaOrgConfig: false };
  }

  /** Resend v4 reports failures in the return value instead of throwing. */
  private logResendError(error: { name: string; message: string }, to: string, subject: string, msg: string): void {
    this.logger.error({ errorName: error.name, error: error.message, to, subject }, msg);
  }
}
