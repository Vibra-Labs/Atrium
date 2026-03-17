import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateSettingsDto } from "./settings.dto";
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

@Injectable()
export class SettingsService {
  private encryptionKey: Buffer;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @InjectPinoLogger(SettingsService.name) private readonly logger: PinoLogger,
  ) {
    const secret = this.config.getOrThrow<string>("BETTER_AUTH_SECRET");
    // Derive a dedicated encryption key using HKDF so the auth signing
    // secret is never reused directly as AES key material.
    this.encryptionKey = Buffer.from(
      hkdfSync("sha256", secret, "atrium-settings-encryption", "aes-256-gcm-key", 32),
    );
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:ciphertext (all hex)
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  private decrypt(encryptedValue: string): string {
    try {
      const [ivHex, authTagHex, ciphertextHex] = encryptedValue.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const ciphertext = Buffer.from(ciphertextHex, "hex");
      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      this.logger.warn("Failed to decrypt settings value — returning empty string");
      return "";
    }
  }

  async getSettings(organizationId: string) {
    const settings = await this.prisma.systemSettings.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });

    // Mask sensitive fields for API responses
    return {
      ...settings,
      resendApiKey: settings.resendApiKey ? "••••••••" : null,
      smtpPass: settings.smtpPass ? "••••••••" : null,
      paymentDetails: settings.paymentDetails ? "••••••••" : null,
    };
  }

  async updateSettings(organizationId: string, dto: UpdateSettingsDto) {
    const data: Record<string, unknown> = {};

    // Copy non-sensitive fields directly
    if (dto.emailProvider !== undefined) data.emailProvider = dto.emailProvider;
    if (dto.emailFrom !== undefined) data.emailFrom = dto.emailFrom;
    if (dto.smtpHost !== undefined) data.smtpHost = dto.smtpHost;
    if (dto.smtpPort !== undefined) data.smtpPort = dto.smtpPort;
    if (dto.smtpUser !== undefined) data.smtpUser = dto.smtpUser;
    if (dto.smtpSecure !== undefined) data.smtpSecure = dto.smtpSecure;
    if (dto.maxFileSizeMb !== undefined) data.maxFileSizeMb = dto.maxFileSizeMb;
    if (dto.paymentInstructions !== undefined) data.paymentInstructions = dto.paymentInstructions;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;

    // Encrypt sensitive fields
    if (dto.resendApiKey !== undefined) {
      data.resendApiKey = dto.resendApiKey ? this.encrypt(dto.resendApiKey) : null;
    }
    if (dto.smtpPass !== undefined) {
      data.smtpPass = dto.smtpPass ? this.encrypt(dto.smtpPass) : null;
    }
    if (dto.paymentDetails !== undefined) {
      data.paymentDetails = dto.paymentDetails ? this.encrypt(dto.paymentDetails) : null;
    }

    const settings = await this.prisma.systemSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });

    return {
      ...settings,
      resendApiKey: settings.resendApiKey ? "••••••••" : null,
      smtpPass: settings.smtpPass ? "••••••••" : null,
      paymentDetails: settings.paymentDetails ? "••••••••" : null,
    };
  }

  async getPaymentInstructions(organizationId: string) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId },
    });

    return {
      paymentInstructions: settings?.paymentInstructions ?? null,
      paymentMethod: settings?.paymentMethod ?? null,
    };
  }

  async getEffectiveEmailConfig(organizationId: string) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId },
    });

    const provider =
      settings?.emailProvider ??
      (this.config.get("RESEND_API_KEY") ? "resend" : null);

    const apiKey = settings?.resendApiKey
      ? this.decrypt(settings.resendApiKey)
      : this.config.get("RESEND_API_KEY") ?? null;

    const from: string =
      settings?.emailFrom ??
      this.config.get("EMAIL_FROM") ??
      "noreply@atrium.local";

    return {
      provider,
      apiKey,
      from,
      smtp: provider === "smtp"
        ? {
            host: settings?.smtpHost ?? null,
            port: settings?.smtpPort ?? 587,
            user: settings?.smtpUser ?? null,
            pass: settings?.smtpPass
              ? this.decrypt(settings.smtpPass)
              : null,
            secure: settings?.smtpSecure ?? true,
          }
        : null,
    };
  }

  async getEffectiveMaxFileSize(organizationId: string): Promise<number> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId },
    });

    if (settings?.maxFileSizeMb) return settings.maxFileSizeMb;

    const envMax = this.config.get("MAX_FILE_SIZE_MB");
    if (envMax) return parseInt(envMax, 10);

    return 50;
  }

  async testEmailConfig(organizationId: string, recipientEmail: string) {
    const emailConfig = await this.getEffectiveEmailConfig(organizationId);

    if (!emailConfig.provider) {
      return { success: false, message: "No email provider configured" };
    }

    try {
      if (emailConfig.provider === "resend") {
        if (!emailConfig.apiKey) {
          return { success: false, message: "Resend API key not configured" };
        }
        const { Resend } = await import("resend");
        const resend = new Resend(emailConfig.apiKey);
        await resend.emails.send({
          from: emailConfig.from,
          to: recipientEmail,
          subject: "Atrium - Test Email",
          html: `<p>This is a test email from Atrium to verify your email configuration is working correctly.</p><p>If you received this, your email settings are configured properly.</p>`,
        });
      } else if (emailConfig.provider === "smtp") {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: emailConfig.smtp!.host ?? undefined,
          port: emailConfig.smtp!.port,
          secure: emailConfig.smtp!.secure,
          auth:
            emailConfig.smtp!.user && emailConfig.smtp!.pass
              ? {
                  user: emailConfig.smtp!.user,
                  pass: emailConfig.smtp!.pass,
                }
              : undefined,
        });
        await transporter.sendMail({
          from: emailConfig.from,
          to: recipientEmail,
          subject: "Atrium - Test Email",
          html: `<p>This is a test email from Atrium to verify your email configuration is working correctly.</p><p>If you received this, your email settings are configured properly.</p>`,
        });
      }

      this.logger.info({ recipientEmail }, "Test email sent successfully");
      return { success: true, message: "Test email sent" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.warn({ recipientEmail, error: message }, "Test email failed");
      return { success: false, message: `Failed to send test email: ${message}` };
    }
  }
}
