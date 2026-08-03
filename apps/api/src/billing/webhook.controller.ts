import {
  Controller,
  Post,
  Req,
  RawBodyRequest,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../common";
import { BillingService } from "./billing.service";
import { StripeService } from "./stripe.service";

@Controller("billing")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private billingService: BillingService,
    private stripeService: StripeService,
  ) {}

  @Post("webhook")
  @Public()
  @SkipThrottle()
  async handleWebhook(@Req() req: RawBodyRequest<Request>) {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = this.stripeService.resolveKey("WEBHOOK_SECRET");

    if (!sig || !webhookSecret) {
      throw new BadRequestException("Missing webhook signature or secret");
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException("Missing raw body for webhook verification");
    }

    try {
      const event = this.stripeService.stripe.webhooks.constructEvent(
        rawBody,
        sig,
        webhookSecret,
      );
      await this.billingService.handleWebhookEvent(event);
      return { received: true };
    } catch (err) {
      this.logger.error("Webhook signature verification failed", err);
      throw new BadRequestException("Webhook signature verification failed");
    }
  }
}
