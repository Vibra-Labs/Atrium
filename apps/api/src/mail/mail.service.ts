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

@Injectable()
export class MailService {
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

  async send(to: string, subject: string, html: string, organizationId?: string) {
    // If an organizationId is provided, try to use DB-configured email settings
    if (organizationId) {
      try {
        const emailConfig = await this.settingsService.getEffectiveEmailConfig(organizationId);

        if (emailConfig.provider === "resend" && emailConfig.apiKey) {
          const resend = new Resend(emailConfig.apiKey);
          await resend.emails.send({
            from: emailConfig.from,
            to,
            subject,
            html,
          });
          this.logger.info({ to, subject }, "Email sent via DB-configured Resend");
          return;
        }

        if (emailConfig.provider === "smtp" && emailConfig.smtp) {
          const transporter = this.getSmtpTransporter(emailConfig.smtp, organizationId);
          await transporter.sendMail({
            from: emailConfig.from,
            to,
            subject,
            html,
          });
          this.logger.info({ to, subject }, "Email sent via DB-configured SMTP");
          return;
        }

        // If DB config has no provider set, fall through to env-var fallback
      } catch (err) {
        this.logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to send via DB email config, falling back to env vars",
        );
      }
    }

    // Fallback: use env-var configured Resend client
    if (!this.resend) {
      this.logger.info({ to, subject }, "Email not sent (no email provider configured)");
      return;
    }

    await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });
    this.logger.info({ to, subject }, "Email sent");
  }
}
