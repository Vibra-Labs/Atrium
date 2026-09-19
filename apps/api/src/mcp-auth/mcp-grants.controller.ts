import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentMember, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import type { AuthenticatedRequest } from "../common";
import { UserOnlyAuthGuard } from "../account/user-only-auth.guard";
import { McpAuthService } from "./mcp-auth.service";
import type { GrantSummary } from "./mcp-auth.service";
import { describeRedirect } from "./redirect-display";
import type { RedirectDisplay } from "./redirect-display";
import { CreateMcpGrantDto } from "./mcp-grants.dto";

interface ConsentInfo {
  client: { clientId: string; name: string };
  organizations: { id: string; name: string }[];
  /** Where approving sends the browser, in words the user can sanity-check. */
  redirect: RedirectDisplay;
}

/** Used by the OAuth consent screen. The user may not have the target org active. */
@Controller("mcp-grants")
@UseGuards(UserOnlyAuthGuard)
export class McpConsentController {
  constructor(private mcpAuth: McpAuthService) {}

  @Get("consent-info")
  async consentInfo(
    @Query("consentCode") consentCode: string,
    @CurrentUser("id") userId: string,
  ): Promise<ConsentInfo> {
    if (!consentCode) throw new BadRequestException("consentCode is required");
    const request = await this.mcpAuth.consentRequest(consentCode, userId);
    const [client, organizations] = await Promise.all([
      this.mcpAuth.getClient(request.clientId),
      this.mcpAuth.adminOrganizations(userId),
    ]);
    return { client, organizations, redirect: describeRedirect(request.redirectURI) };
  }

  @Post()
  async create(
    @Body() dto: CreateMcpGrantDto,
    @Req() req: AuthenticatedRequest,
    @CurrentUser("id") userId: string,
  ): Promise<void> {
    // A grant binds an OAuth client to a workspace on the user's behalf; it
    // must come from the browser consent screen, not a leaked API key.
    if (req.apiKeyId) {
      throw new ForbiddenException("API keys cannot create MCP grants. Sign in to the dashboard.");
    }
    // The client id comes from the consent code's own row, so the grant can
    // only ever be written for the client the user is actually being asked about.
    const { clientId } = await this.mcpAuth.consentRequest(dto.consentCode, userId);
    await this.mcpAuth.saveGrant(userId, clientId, dto.organizationId);
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
