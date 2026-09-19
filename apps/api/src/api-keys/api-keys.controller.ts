import {
  Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import type { AuthenticatedRequest } from "../common";
import { ApiKeysService } from "./api-keys.service";
import type { ApiKeySummary, CreatedApiKey } from "./api-keys.service";
import { CreateApiKeyDto } from "./api-keys.dto";

@Controller("api-keys")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class ApiKeysController {
  constructor(private apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentOrg("id") orgId: string): Promise<ApiKeySummary[]> {
    return this.apiKeys.list(orgId);
  }

  @Post()
  create(
    @Body() dto: CreateApiKeyDto,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ): Promise<CreatedApiKey> {
    // A leaked key must not be able to mint more keys.
    if (req.apiKeyId) {
      throw new ForbiddenException("API keys cannot create API keys. Sign in to the dashboard.");
    }
    return this.apiKeys.create(dto.name, userId, orgId);
  }

  @Delete(":id")
  revoke(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
  ): Promise<void> {
    // A leaked key must not be able to revoke the workspace's other keys.
    if (req.apiKeyId) {
      throw new ForbiddenException("API keys cannot revoke API keys. Sign in to the dashboard.");
    }
    return this.apiKeys.revoke(id, orgId);
  }
}
