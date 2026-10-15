import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import {
  AuthGuard, CurrentOrg, CurrentUser, PaginationQueryDto, RequiresFeature, Roles, RolesGuard,
} from "../common";
import type { AuthenticatedRequest } from "../common";
import { IntegrationsService } from "./integrations.service";
import type {
  CreatedIntegration, DeliveryPage, DeliverySummary, IntegrationSummary, TestResult,
} from "./integrations.service";
import { CreateIntegrationDto, UpdateIntegrationDto } from "./integrations.dto";

/**
 * A destination URL receives every subscribed event, so a leaked API key must
 * not be able to point one somewhere new.
 */
function assertNotApiKey(req: AuthenticatedRequest): void {
  if (req.apiKeyId) {
    throw new ForbiddenException("API keys cannot change integrations. Sign in to the dashboard.");
  }
}

@Controller("integrations")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
@RequiresFeature("integrations")
export class IntegrationsController {
  constructor(private integrations: IntegrationsService) {}

  @Get()
  list(@CurrentOrg("id") orgId: string): Promise<IntegrationSummary[]> {
    return this.integrations.list(orgId);
  }

  @Post()
  create(
    @Body() dto: CreateIntegrationDto,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ): Promise<CreatedIntegration> {
    assertNotApiKey(req);
    return this.integrations.create(dto, orgId, userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateIntegrationDto,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
  ): Promise<IntegrationSummary> {
    assertNotApiKey(req);
    return this.integrations.update(id, dto, orgId);
  }

  @Delete(":id")
  remove(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
  ): Promise<void> {
    assertNotApiKey(req);
    return this.integrations.remove(id, orgId);
  }

  @Post(":id/test")
  @HttpCode(200)
  test(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ): Promise<TestResult> {
    return this.integrations.test(id, orgId, userId);
  }

  @Post(":id/rotate-secret")
  @HttpCode(200)
  rotateSecret(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
  ): Promise<{ secret: string }> {
    assertNotApiKey(req);
    return this.integrations.rotateSecret(id, orgId);
  }

  @Get(":id/deliveries")
  deliveries(
    @Param("id") id: string,
    @Query() query: PaginationQueryDto,
    @CurrentOrg("id") orgId: string,
  ): Promise<DeliveryPage> {
    return this.integrations.listDeliveries(id, orgId, query.page ?? 1, query.limit ?? 20);
  }

  @Post("deliveries/:deliveryId/resend")
  @HttpCode(200)
  resend(
    @Param("deliveryId") deliveryId: string,
    @CurrentOrg("id") orgId: string,
  ): Promise<DeliverySummary | null> {
    return this.integrations.resend(deliveryId, orgId);
  }
}
