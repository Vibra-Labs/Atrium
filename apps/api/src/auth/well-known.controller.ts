import { Controller, Get, Header, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common";
import { AuthService } from "./auth.service";

type MetadataFn = () => Promise<Record<string, unknown> | null>;

/**
 * OAuth discovery documents at the origin root, where MCP clients look for
 * them. The paths are excluded from the global "api" prefix in main.ts, and
 * main.ts's CORS delegate serves them with a wildcard Access-Control-Allow-
 * Origin (and no credentials), so no per-route CORS header is needed here.
 */
@Controller(".well-known")
@Public()
@SkipThrottle()
export class WellKnownController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Get(["oauth-authorization-server", "oauth-authorization-server/api/auth"])
  @Header("Cache-Control", "public, max-age=300")
  authorizationServer(): Promise<Record<string, unknown>> {
    return this.metadata("getMcpOAuthConfig");
  }

  @Get(["oauth-protected-resource", "oauth-protected-resource/api/mcp"])
  @Header("Cache-Control", "public, max-age=300")
  protectedResource(): Promise<Record<string, unknown>> {
    return this.metadata("getMCPProtectedResource");
  }

  private async metadata(name: "getMcpOAuthConfig" | "getMCPProtectedResource"): Promise<Record<string, unknown>> {
    if (this.config.get("MCP_OAUTH_ENABLED", "true") === "false") throw new NotFoundException();
    const api = this.authService.auth.api as unknown as Partial<Record<typeof name, MetadataFn>>;
    const fn: MetadataFn | undefined = api[name];
    const doc: Record<string, unknown> | null = fn ? await fn() : null;
    if (!doc) throw new NotFoundException();
    return doc;
  }
}
