import { Controller, Get, Header, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import { mcpOAuthEnabled, mcpResourceUrl, Public } from "../common";
import { publicApiUrl } from "../common/helpers/public-api-url";
import { AuthService } from "./auth.service";

type Metadata = Record<string, unknown>;

/** The MCP plugin's server-only discovery endpoint, which `auth`'s plugin-less type leaves out. */
type GetOAuthServerConfig = () => Promise<Metadata>;

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
  async authorizationServer(): Promise<Metadata> {
    this.assertEnabled();
    const api = this.authService.auth.api as unknown as { getOAuthServerConfig?: GetOAuthServerConfig };
    if (!api.getOAuthServerConfig) throw new NotFoundException();
    // The MCP endpoint does not check DPoP proofs, so don't invite clients to use them.
    const { dpop_signing_alg_values_supported: _dpop, ...doc } = await api.getOAuthServerConfig();
    return doc;
  }

  /** RFC 9728 metadata for the MCP endpoint, whose tokens this API issues itself. */
  @Get(["oauth-protected-resource", "oauth-protected-resource/api/mcp"])
  @Header("Cache-Control", "public, max-age=300")
  protectedResource(): Metadata {
    this.assertEnabled();
    return {
      resource: mcpResourceUrl(this.config),
      authorization_servers: [`${publicApiUrl(this.config)}/api/auth`],
      bearer_methods_supported: ["header"],
    };
  }

  private assertEnabled(): void {
    if (!mcpOAuthEnabled(this.config)) throw new NotFoundException();
  }
}
