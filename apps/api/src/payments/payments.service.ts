import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../billing/stripe.service";
import { SettingsService } from "../settings/settings.service";
import { NotificationsService } from "../notifications/notifications.service";
import { calculateInvoiceTotal } from "./invoice-total";

interface StripeConfig {
  stripe: Stripe;
  stripeAccount?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly webUrl: string;
  private readonly apiUrl: string;
  private readonly appOrigin: string;
  private readonly currency: string;
  private readonly hmacSecret: string;

  private static readonly PAYMENTS_CLEAR_DATA = {
    stripeSecretKey: null,
    stripeWebhookSecret: null,
    stripeConnectAccountId: null,
    stripeConnectEnabled: false,
    stripeConnectLivemode: false,
  } as const;

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private settingsService: SettingsService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {
    this.webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    this.apiUrl = this.config.get("API_URL", "http://localhost:3001");
    this.appOrigin = new URL(this.webUrl).origin;
    this.currency = this.config.get("STRIPE_CURRENCY", "usd").toLowerCase();
    this.hmacSecret = this.config.getOrThrow<string>("BETTER_AUTH_SECRET");
  }

  // ── Helpers ──

  isConnectMode(): boolean {
    return !!this.config.get<string>("STRIPE_CONNECT_CLIENT_ID");
  }

  private async getStripeConfig(orgId: string): Promise<StripeConfig> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
    });

    // Connect mode: platform stripe instance + stripeAccount param
    if (settings?.stripeConnectEnabled && settings.stripeConnectAccountId) {
      return {
        stripe: this.stripeService.stripe,
        stripeAccount: settings.stripeConnectAccountId,
      };
    }

    // Direct keys mode: agency's own stripe instance
    if (settings?.stripeSecretKey) {
      const key = this.settingsService.decrypt(settings.stripeSecretKey);
      if (!key) {
        throw new BadRequestException("Failed to decrypt Stripe key. Re-enter your key in Settings.");
      }
      return { stripe: new Stripe(key) };
    }

    throw new BadRequestException("Online payments are not configured");
  }

  private signState(payload: string): string {
    return `${payload}.${createHmac("sha256", this.hmacSecret).update(payload).digest("base64url")}`;
  }

  private verifyState(state: string): string {
    const lastDot = state.lastIndexOf(".");
    if (lastDot === -1) throw new BadRequestException("Invalid OAuth state");
    const payload = state.slice(0, lastDot);
    const sig = state.slice(lastDot + 1);
    const expected = createHmac("sha256", this.hmacSecret).update(payload).digest("base64url");
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      throw new BadRequestException("Invalid OAuth state signature");
    }
    return payload;
  }

  private validateAppUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== this.appOrigin) {
        throw new BadRequestException("URL must be on the application domain");
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException("Invalid URL");
    }
  }

  buildOAuthErrorRedirect(error?: string): string {
    const status = error === "access_denied" ? "cancelled" : "error";
    return `${this.webUrl}/dashboard/settings/system?stripe=${status}`;
  }

  // ── Unified status ──

  async getPaymentStatus(orgId: string) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
    });
    const connectMode = this.isConnectMode();

    if (connectMode && settings?.stripeConnectAccountId) {
      return {
        mode: "connect" as const,
        enabled: settings.stripeConnectEnabled,
        livemode: settings.stripeConnectLivemode,
      };
    }

    if (settings?.stripeSecretKey) {
      return {
        mode: "direct" as const,
        enabled: settings.stripeConnectEnabled,
        livemode: settings.stripeConnectLivemode,
      };
    }

    return {
      mode: connectMode ? ("connect" as const) : ("direct" as const),
      enabled: false,
      livemode: false,
    };
  }

  // ── Direct Keys mode ──

  async saveDirectKeys(orgId: string, secretKey: string) {
    if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_") && !secretKey.startsWith("rk_test_") && !secretKey.startsWith("rk_live_")) {
      throw new BadRequestException("Invalid Stripe key format. Use a secret key (sk_) or restricted key (rk_).");
    }

    const livemode = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");

    // Clean up old webhook if replacing an existing key
    const existing = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
      select: { stripeSecretKey: true },
    });
    if (existing?.stripeSecretKey) {
      try {
        const oldKey = this.settingsService.decrypt(existing.stripeSecretKey);
        if (oldKey) {
          const oldStripe = new Stripe(oldKey);
          const webhookUrl = `${this.apiUrl}/api/payments/webhook/${orgId}`;
          const endpoints = await oldStripe.webhookEndpoints.list({ limit: 100 });
          for (const ep of endpoints.data) {
            if (ep.url === webhookUrl) await oldStripe.webhookEndpoints.del(ep.id);
          }
        }
      } catch {
        // Best-effort cleanup
      }
    }

    const encrypted = this.settingsService.encrypt(secretKey);

    const stripe = new Stripe(secretKey);
    try {
      await stripe.balance.retrieve();
    } catch {
      throw new BadRequestException("Invalid Stripe key. Could not connect to your Stripe account.");
    }

    // Auto-register webhook endpoint on the agency's Stripe account
    const webhookUrl = `${this.apiUrl}/api/payments/webhook/${orgId}`;
    let webhookSecret: string;
    try {
      const endpoint = await stripe.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: [
          "checkout.session.completed",
          "checkout.session.expired",
        ],
      });
      if (!endpoint.secret) {
        throw new Error("Stripe did not return a webhook signing secret");
      }
      webhookSecret = endpoint.secret;
    } catch (err) {
      this.logger.error("Failed to register webhook endpoint", err);
      throw new BadRequestException(
        "Failed to register webhook on your Stripe account. Check that your API URL is publicly accessible.",
      );
    }

    await this.prisma.systemSettings.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        stripeSecretKey: encrypted,
        stripeWebhookSecret: this.settingsService.encrypt(webhookSecret),
        stripeConnectEnabled: true,
        stripeConnectLivemode: livemode,
      },
      update: {
        stripeSecretKey: encrypted,
        stripeWebhookSecret: this.settingsService.encrypt(webhookSecret),
        stripeConnectEnabled: true,
        stripeConnectLivemode: livemode,
        // Clear any Connect fields
        stripeConnectAccountId: null,
      },
    });

    this.logger.log(`Saved direct Stripe key for org ${orgId} (livemode: ${livemode})`);
    return { livemode };
  }

  async removeDirectKeys(orgId: string) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
    });

    if (!settings?.stripeSecretKey) {
      throw new BadRequestException("No Stripe key configured");
    }

    // Try to clean up the webhook endpoint on Stripe's side
    try {
      const key = this.settingsService.decrypt(settings.stripeSecretKey);
      const stripe = new Stripe(key);
      const webhookUrl = `${this.apiUrl}/api/payments/webhook/${orgId}`;
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
      for (const ep of endpoints.data) {
        if (ep.url === webhookUrl) {
          await stripe.webhookEndpoints.del(ep.id);
        }
      }
    } catch (err) {
      this.logger.warn("Failed to delete webhook endpoint on Stripe side", err);
    }

    await this.prisma.systemSettings.update({
      where: { organizationId: orgId },
      data: PaymentsService.PAYMENTS_CLEAR_DATA,
    });

    this.logger.log(`Removed direct Stripe key for org ${orgId}`);
  }

  // ── Stripe Connect OAuth ──

  async getConnectAuthorizeUrl(orgId: string, returnUrl: string) {
    this.validateAppUrl(returnUrl);

    const clientId = this.config.get<string>("STRIPE_CONNECT_CLIENT_ID");
    if (!clientId) {
      throw new BadRequestException("Stripe Connect is not configured.");
    }

    const payload = `${orgId}:${Buffer.from(returnUrl).toString("base64url")}`;
    const state = this.signState(payload);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_write",
      state,
    });

    return {
      url: `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
    };
  }

  async handleOAuthCallback(code: string, state: string) {
    const payload = this.verifyState(state);
    const colonIdx = payload.indexOf(":");
    if (colonIdx === -1) throw new BadRequestException("Invalid OAuth state");

    const orgId = payload.slice(0, colonIdx);
    const returnUrlB64 = payload.slice(colonIdx + 1);
    const returnUrl = Buffer.from(returnUrlB64, "base64url").toString();
    this.validateAppUrl(returnUrl);

    try {
      const response = await this.stripeService.stripe.oauth.token({
        grant_type: "authorization_code",
        code,
      });

      const accountId = response.stripe_user_id;
      if (!accountId) throw new BadRequestException("No account ID returned from Stripe");

      await this.prisma.systemSettings.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          stripeConnectAccountId: accountId,
          stripeConnectEnabled: true,
          stripeConnectLivemode: response.livemode ?? false,
        },
        update: {
          stripeConnectAccountId: accountId,
          stripeConnectEnabled: true,
          stripeConnectLivemode: response.livemode ?? false,
          stripeSecretKey: null,
          stripeWebhookSecret: null,
        },
      });

      this.logger.log(`Connected Stripe account ${accountId} for org ${orgId}`);
      return { returnUrl };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ForbiddenException) throw err;
      this.logger.error("Stripe Connect OAuth failed", err);
      throw new BadRequestException("Failed to connect Stripe account");
    }
  }

  async disconnectAccount(orgId: string) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
    });

    if (!settings?.stripeConnectAccountId) {
      throw new BadRequestException("No Stripe account connected");
    }

    const clientId = this.config.get<string>("STRIPE_CONNECT_CLIENT_ID");
    if (clientId) {
      try {
        await this.stripeService.stripe.oauth.deauthorize({
          client_id: clientId,
          stripe_user_id: settings.stripeConnectAccountId,
        });
      } catch (err) {
        this.logger.warn("Failed to deauthorize on Stripe side", err);
      }
    }

    await this.prisma.systemSettings.update({
      where: { organizationId: orgId },
      data: PaymentsService.PAYMENTS_CLEAR_DATA,
    });

    this.logger.log(`Disconnected Stripe account for org ${orgId}`);
  }

  // ── Invoice Checkout (mode-agnostic) ──

  async createCheckoutSession(
    invoiceId: string,
    userId: string,
    orgId: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    this.validateAppUrl(successUrl);
    this.validateAppUrl(cancelUrl);

    const [config, invoice] = await Promise.all([
      this.getStripeConfig(orgId),
      this.prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId: orgId },
        include: { lineItems: true },
      }),
    ]);

    if (!invoice) throw new NotFoundException("Invoice not found");

    if (invoice.projectId) {
      const assignment = await this.prisma.projectClient.findFirst({
        where: { projectId: invoice.projectId, userId },
      });
      if (!assignment) throw new ForbiddenException("Not assigned to this project");
    } else {
      throw new ForbiddenException("Invoice has no associated project");
    }

    if (!["sent", "overdue"].includes(invoice.status)) {
      throw new BadRequestException(`Invoice is ${invoice.status} and cannot be paid`);
    }

    // Reuse existing open session
    if (invoice.stripeCheckoutSessionId) {
      try {
        const existingSession = await config.stripe.checkout.sessions.retrieve(
          invoice.stripeCheckoutSessionId,
          config.stripeAccount ? { stripeAccount: config.stripeAccount } : undefined,
        );
        if (existingSession.status === "open" && existingSession.url) {
          return { url: existingSession.url };
        }
      } catch {
        // Session expired or invalid, create a new one
      }
    }

    const totalCents = calculateInvoiceTotal(invoice);
    if (totalCents <= 0) {
      throw new BadRequestException("Invoice total must be greater than zero");
    }

    const lineItems =
      invoice.type === "uploaded" || invoice.lineItems.length === 0
        ? [{
            price_data: {
              currency: this.currency,
              product_data: { name: `Invoice ${invoice.invoiceNumber}` },
              unit_amount: totalCents,
            },
            quantity: 1,
          }]
        : invoice.lineItems.map((li) => ({
            price_data: {
              currency: this.currency,
              product_data: { name: li.description },
              unit_amount: li.unitPrice,
            },
            quantity: li.quantity,
          }));

    const session = await config.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          invoiceId: invoice.id,
          organizationId: orgId,
        },
        payment_intent_data: {
          metadata: {
            invoiceId: invoice.id,
            organizationId: orgId,
          },
        },
      },
      config.stripeAccount ? { stripeAccount: config.stripeAccount } : undefined,
    );

    await this.prisma.invoice.updateMany({
      where: {
        id: invoice.id,
        stripeCheckoutSessionId: invoice.stripeCheckoutSessionId,
      },
      data: { stripeCheckoutSessionId: session.id },
    });

    return { url: session.url };
  }

  // ── Webhook handling (mode-agnostic) ──

  getConnectWebhookSecret(): string | undefined {
    return this.config.get<string>("STRIPE_CONNECT_WEBHOOK_SECRET");
  }

  async getOrgWebhookSecret(orgId: string): Promise<string | null> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
      select: { stripeWebhookSecret: true },
    });
    if (!settings?.stripeWebhookSecret) return null;
    const decrypted = this.settingsService.decrypt(settings.stripeWebhookSecret);
    if (!decrypted) return null;
    return decrypted;
  }

  async handleWebhookEvent(event: Stripe.Event, verifiedOrgId?: string) {
    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutCompleted(
          event.data.object as unknown as Record<string, unknown>,
          event.account,
          verifiedOrgId,
        );
        break;
      case "account.application.deauthorized":
        await this.handleAccountDeauthorized(event.account);
        break;
      case "checkout.session.expired":
        await this.handleCheckoutExpired(
          event.data.object as unknown as Record<string, unknown>,
        );
        break;
    }
  }

  private async handleAccountDeauthorized(connectedAccountId?: string) {
    if (!connectedAccountId) return;

    const settings = await this.prisma.systemSettings.findFirst({
      where: { stripeConnectAccountId: connectedAccountId },
    });
    if (!settings) return;

    await this.prisma.systemSettings.update({
      where: { id: settings.id },
      data: PaymentsService.PAYMENTS_CLEAR_DATA,
    });

    this.logger.log(
      `Stripe account ${connectedAccountId} deauthorized — disabled payments for org ${settings.organizationId}`,
    );
    this.notifications.notifyStripeDisconnected(settings.organizationId);
  }

  private async handleCheckoutExpired(session: Record<string, unknown>) {
    const metadata = session.metadata as
      | { invoiceId?: string }
      | undefined;
    if (!metadata?.invoiceId) return;

    await this.prisma.invoice.updateMany({
      where: {
        id: metadata.invoiceId,
        stripeCheckoutSessionId: session.id as string,
      },
      data: { stripeCheckoutSessionId: null },
    });

    this.logger.log(`Checkout session expired for invoice ${metadata.invoiceId}`);
  }

  private async handleCheckoutCompleted(
    session: Record<string, unknown>,
    connectedAccountId?: string,
    verifiedOrgId?: string,
  ) {
    const metadata = session.metadata as
      | { invoiceId?: string; organizationId?: string }
      | undefined;
    if (!metadata?.invoiceId || !metadata?.organizationId) return;

    // In direct mode, verify metadata orgId matches the org whose webhook secret verified the signature
    if (verifiedOrgId && metadata.organizationId !== verifiedOrgId) {
      this.logger.warn(
        `Webhook org mismatch: metadata says ${metadata.organizationId} but webhook secret belongs to ${verifiedOrgId}`,
      );
      return;
    }

    // In Connect mode, verify the connected account matches
    if (connectedAccountId) {
      const settings = await this.prisma.systemSettings.findUnique({
        where: { organizationId: metadata.organizationId },
      });
      if (settings?.stripeConnectAccountId !== connectedAccountId) {
        this.logger.warn(
          `Webhook account ${connectedAccountId} does not match org ${metadata.organizationId}`,
        );
        return;
      }
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: metadata.invoiceId,
        organizationId: metadata.organizationId,
      },
      include: { lineItems: true },
    });
    if (!invoice) return;

    const totalCents = calculateInvoiceTotal(invoice);

    // Idempotent update: only mark as paid if not already paid
    const result = await this.prisma.invoice.updateMany({
      where: { id: invoice.id, status: { not: "paid" } },
      data: {
        status: "paid",
        paidAt: new Date(),
        paidAmount: (session.amount_total as number) ?? totalCents,
        stripePaymentIntentId: (session.payment_intent as string) ?? null,
      },
    });

    if (result.count === 0) return; // Already processed

    this.logger.log(`Invoice ${invoice.invoiceNumber} marked as paid via Stripe`);
    this.notifications.notifyInvoicePaid(invoice.id);
  }
}
