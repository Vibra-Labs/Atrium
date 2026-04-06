import * as Sentry from "@sentry/nestjs";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import * as webPush from "web-push";
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

interface PushPayload {
  title: string;
  message: string;
  link?: string;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

@Injectable()
export class PushService {
  private encryptionKey: Buffer;
  private vapidSubject: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @InjectPinoLogger(PushService.name)
    private readonly logger: PinoLogger,
  ) {
    const secret = this.config.getOrThrow<string>("BETTER_AUTH_SECRET");
    this.encryptionKey = Buffer.from(
      hkdfSync("sha256", secret, "atrium-settings-encryption", "aes-256-gcm-key", 32),
    );
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    this.vapidSubject = `mailto:noreply@${new URL(webUrl).hostname}`;
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  private decrypt(encryptedValue: string): string | null {
    try {
      const [ivHex, authTagHex, ciphertextHex] = encryptedValue.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const ciphertext = Buffer.from(ciphertextHex, "hex");
      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      const result = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      return result || null;
    } catch {
      this.logger.warn("Failed to decrypt VAPID key");
      return null;
    }
  }

  async getOrCreateVapidKeys(orgId: string): Promise<VapidKeys> {
    // Use a serializable transaction to prevent race conditions where two
    // concurrent requests both see no keys and each generate/store different ones.
    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.systemSettings.findUnique({
        where: { organizationId: orgId },
        select: { vapidPublicKey: true, vapidPrivateKey: true },
      });

      if (settings?.vapidPublicKey && settings?.vapidPrivateKey) {
        const publicKey = this.decrypt(settings.vapidPublicKey);
        const privateKey = this.decrypt(settings.vapidPrivateKey);
        // If decryption fails, fall through to regenerate
        if (publicKey && privateKey) {
          return { publicKey, privateKey };
        }
        this.logger.warn({ orgId }, "VAPID key decryption failed, regenerating");
      }

      const vapidKeys = webPush.generateVAPIDKeys();

      await tx.systemSettings.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          vapidPublicKey: this.encrypt(vapidKeys.publicKey),
          vapidPrivateKey: this.encrypt(vapidKeys.privateKey),
        },
        update: {
          vapidPublicKey: this.encrypt(vapidKeys.publicKey),
          vapidPrivateKey: this.encrypt(vapidKeys.privateKey),
        },
      });

      this.logger.info({ orgId }, "Auto-generated VAPID keys");
      return vapidKeys;
    });
  }

  async getPublicKey(orgId: string): Promise<string> {
    const keys = await this.getOrCreateVapidKeys(orgId);
    return keys.publicKey;
  }

  async subscribe(
    userId: string,
    orgId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    await this.prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: { userId, endpoint: subscription.endpoint },
      },
      create: {
        userId,
        organizationId: orgId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async unsubscribe(userId: string, orgId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, organizationId: orgId, endpoint },
    });
  }

  async sendToUser(
    userId: string,
    orgId: string,
    payload: PushPayload,
    vapidKeys: VapidKeys,
  ): Promise<void> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, organizationId: orgId },
    });

    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);
    const vapidDetails = {
      subject: this.vapidSubject,
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey,
    };

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
            { vapidDetails },
          );
        } catch (err: any) {
          // Remove expired/invalid subscriptions
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            Sentry.captureException(err);
          }
          this.logger.warn(
            { err: err?.message, endpoint: sub.endpoint },
            "Failed to send push notification",
          );
        }
      }),
    );
  }

  async sendToMany(userIds: string[], orgId: string, payload: PushPayload): Promise<void> {
    if (userIds.length === 0) return;

    // Fetch VAPID keys once for the entire batch
    const vapidKeys = await this.getOrCreateVapidKeys(orgId);

    await Promise.allSettled(
      userIds.map((userId) => this.sendToUser(userId, orgId, payload, vapidKeys)),
    );
  }

  async isEnabled(orgId: string): Promise<boolean> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
      select: { vapidPublicKey: true },
    });
    return !!settings?.vapidPublicKey;
  }
}
