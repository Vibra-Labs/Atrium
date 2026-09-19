import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentMember, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import type { AuthenticatedRequest } from "../common";
import { UserOnlyAuthGuard } from "../account/user-only-auth.guard";
import { McpAuthService } from "./mcp-auth.service";
import type { GrantSummary } from "./mcp-auth.service";
import { CreateMcpGrantDto } from "./mcp-grants.dto";

interface ConsentInfo {
  client: { clientId: string; name: string; icon: string | null };
  organizations: { id: string; name: string }[];
}

/** Used by the OAuth consent screen. The user may not have the target org active. */
@Controller("mcp-grants")
@UseGuards(UserOnlyAuthGuard)
export class McpConsentController {
  constructor(private mcpAuth: McpAuthService) {}

  @Get("consent-info")
  async consentInfo(
    @Query("clientId") clientId: string,
    @CurrentUser("id") userId: string,
  ): Promise<ConsentInfo> {
    if (!clientId) throw new BadRequestException("clientId is required");
    const [client, organizations] = await Promise.all([
      this.mcpAuth.getClient(clientId),
      this.mcpAuth.adminOrganizations(userId),
    ]);
    return { client, organizations };
  }

  @Post()
  create(
    @Body() dto: CreateMcpGrantDto,
    @Req() req: AuthenticatedRequest,
    @CurrentUser("id") userId: string,
  ): Promise<void> {
    // A grant binds an OAuth client to a workspace on the user's behalf; it
    // must come from the browser consent screen, not a leaked API key.
    if (req.apiKeyId) {
      throw new ForbiddenException("API keys cannot create MCP grants. Sign in to the dashboard.");
    }
    return this.mcpAuth.saveGrant(userId, dto.clientId, dto.organizationId);
  }
}

/** Used by Settings → API & MCP → Connected apps. */
@Controller("mcp-grants")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class McpGrantsController {
  constructor(private mcpAuth: McpAuthService) {}

  @Get()
  list(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
  ): Promise<GrantSummary[]> {
    return this.mcpAuth.listGrants(userId, orgId, role);
  }

  @Delete(":id")
  revoke(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
  ): Promise<void> {
    if (req.apiKeyId) {
      throw new ForbiddenException("API keys cannot revoke MCP grants. Sign in to the dashboard.");
    }
    return this.mcpAuth.revokeGrant(id, userId, orgId, role);
  }
}
