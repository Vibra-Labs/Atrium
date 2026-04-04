import {
  Controller,
  Post,
  Param,
  Req,
  RawBodyRequest,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Request } from "express";
import { Public } from "../common";
import { StripeService } from "../billing/stripe.service";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class ConnectWebhookController {
  private readonly logger = new Logger(ConnectWebhookController.name);

  constructor(
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
  ) {}

  /** Connect mode webhook (platform-level, no org in path). */
  @Post("webhook")
  @Public()
  @SkipThrottle()
  async handleConnectWebhook(@Req() req: RawBodyRequest<Request>) {
    const sig = req.headers["stripe-signature"] as string;
    const rawBody = req.rawBody;
    if (!sig || !rawBody) {
      throw new BadRequestException("Missing webhook signature or body");
    }

    const secret = this.paymentsService.getConnectWebhookSecret();
    if (!secret) {
      throw new BadRequestException("Connect webhook secret not configured");
    }

    try {
      const event = this.stripeService.stripe.webhooks.constructEvent(rawBody, sig, secret);
      await this.paymentsService.handleWebhookEvent(event);
      return { received: true };
    } catch (err) {
      this.logger.error("Connect webhook verification failed", err);
      throw new BadRequestException("Webhook signature verification failed");
    }
  }

  /** Direct keys mode webhook (org-scoped, secret from DB). */
  @Post("webhook/:orgId")
  @Public()
  @SkipThrottle()
  async handleDirectWebhook(
    @Param("orgId") orgId: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const sig = req.headers["stripe-signature"] as string;
    const rawBody = req.rawBody;
    if (!sig || !rawBody) {
      throw new BadRequestException("Missing webhook signature or body");
    }

    const secret = await this.paymentsService.getOrgWebhookSecret(orgId);
    if (!secret) {
      throw new BadRequestException("Webhook secret not found for this organization");
    }

    try {
      const event = this.stripeService.stripe.webhooks.constructEvent(rawBody, sig, secret);
      await this.paymentsService.handleWebhookEvent(event, orgId);
      return { received: true };
    } catch (err) {
      this.logger.error(`Direct webhook verification failed for org ${orgId}`, err);
      throw new BadRequestException("Webhook signature verification failed");
    }
  }
}
