import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { PaymentsService } from "./payments.service";
import { CreateCheckoutDto, ConnectAuthorizeDto, SaveDirectKeysDto } from "./payments.dto";
import { AuthGuard, RolesGuard, Roles, CurrentUser, CurrentOrg, Public } from "../common";

@Controller("payments")
@UseGuards(AuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  // ── Unified status ──

  @Get("status")
  @Roles("owner")
  getPaymentStatus(@CurrentOrg("id") orgId: string) {
    return this.paymentsService.getPaymentStatus(orgId);
  }

  @Get("enabled")
  async isEnabled(@CurrentOrg("id") orgId: string) {
    const status = await this.paymentsService.getPaymentStatus(orgId);
    return { enabled: status.enabled };
  }

  // ── Direct keys mode ──

  @Post("direct/save-key")
  @Roles("owner")
  saveDirectKey(
    @CurrentOrg("id") orgId: string,
    @Body() dto: SaveDirectKeysDto,
  ) {
    return this.paymentsService.saveDirectKeys(orgId, dto.stripeSecretKey);
  }

  @Post("direct/remove-key")
  @Roles("owner")
  removeDirectKey(@CurrentOrg("id") orgId: string) {
    return this.paymentsService.removeDirectKeys(orgId);
  }

  // ── Connect OAuth mode ──

  @Post("connect/authorize")
  @Roles("owner")
  getAuthorizeUrl(
    @CurrentOrg("id") orgId: string,
    @Body() dto: ConnectAuthorizeDto,
  ) {
    return this.paymentsService.getConnectAuthorizeUrl(orgId, dto.returnUrl);
  }

  @Get("connect/callback")
  @Public()
  async handleCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Res() res: Response,
  ) {
    if (error || !code) {
      res.redirect(this.paymentsService.buildOAuthErrorRedirect(error));
      return;
    }

    try {
      // Auth is via HMAC-signed state (orgId embedded + verified), not session
      const { returnUrl } = await this.paymentsService.handleOAuthCallback(code, state);
      const separator = returnUrl.includes("?") ? "&" : "?";
      res.redirect(`${returnUrl}${separator}stripe=connected`);
    } catch {
      res.redirect(this.paymentsService.buildOAuthErrorRedirect());
    }
  }

  @Post("connect/disconnect")
  @Roles("owner")
  disconnect(@CurrentOrg("id") orgId: string) {
    return this.paymentsService.disconnectAccount(orgId);
  }

  // ── Checkout (any authenticated user — access checked at service level) ──

  @Post("checkout/:invoiceId")
  createCheckout(
    @Param("invoiceId") invoiceId: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.paymentsService.createCheckoutSession(
      invoiceId,
      userId,
      orgId,
      dto.successUrl,
      dto.cancelUrl,
    );
  }
}
