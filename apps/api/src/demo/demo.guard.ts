import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common";
import { DemoService } from "./demo.service";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

interface BlockedAction {
  methods: readonly string[];
  /** Matched as a prefix of the path, with /api and any query string removed. */
  path: string;
  message: string;
}

/**
 * What the demo refuses. The messages are shown to the visitor verbatim, so
 * they explain rather than scold.
 *
 * Uploads are the main abuse vector — anything a stranger uploads would sit on
 * our infrastructure — and the least interesting thing to demo, since the
 * seeded files already show how files look.
 */
const BLOCKED: readonly BlockedAction[] = [
  { methods: ["POST", "PUT", "PATCH"], path: "/files/upload", message: "Uploads are turned off in the demo." },
  { methods: ["POST"], path: "/branding/logo", message: "Uploads are turned off in the demo." },
  { methods: ["POST", "DELETE"], path: "/api-keys", message: "API keys are turned off in the demo." },
  { methods: ["POST", "DELETE"], path: "/mcp-grants", message: "Connecting AI assistants is turned off in the demo." },
  { methods: ["POST"], path: "/billing", message: "Billing is turned off in the demo." },
  { methods: ["POST"], path: "/payments", message: "Payments are turned off in the demo." },
  // No destination can be created, so nothing reaches IntegrationDispatcher.
  { methods: ["POST", "PUT", "PATCH", "DELETE"], path: "/integrations", message: "Integrations are turned off in the demo." },
  { methods: ["PUT", "DELETE", "POST"], path: "/settings/custom-domain", message: "Custom domains are turned off in the demo." },
  { methods: ["POST"], path: "/auth/organization/invite-member", message: "Inviting people is turned off in the demo." },
  { methods: ["POST"], path: "/auth/organization/delete", message: "Deleting the workspace is turned off in the demo." },
  { methods: ["POST"], path: "/clients/invite", message: "Inviting people is turned off in the demo." },
];

/**
 * Fences the demo workspace. Runs for every request, but only ever refuses one
 * whose resolved organization is the demo workspace, so an ordinary install —
 * and every other workspace on the demo instance — is untouched.
 */
@Injectable()
export class DemoGuard implements CanActivate {
  constructor(private demo: DemoService) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    if (!this.demo.enabled) return true;

    const request = executionContext.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId: string | undefined = request.organization?.id;
    // No organization resolved: nothing to fence. AuthGuard decides access.
    if (!organizationId) return true;
    if (!(await this.demo.isDemoOrg(organizationId))) return true;

    const path: string = this.pathOf(request);
    const method: string = request.method.toUpperCase();

    // Entry and reset are the demo's own controls, never fenced by it.
    if (path.startsWith("/demo/")) return true;

    const blocked: BlockedAction | undefined = BLOCKED.find(
      (action: BlockedAction) =>
        action.methods.includes(method) && path.startsWith(action.path),
    );
    if (blocked) throw new ForbiddenException(blocked.message);

    if (!SAFE_METHODS.has(method)) this.demo.touch();
    return true;
  }

  /** The request path without the global /api prefix or a query string. */
  private pathOf(request: AuthenticatedRequest): string {
    const url: string = request.originalUrl || request.url || "";
    const path: string = url.split("?")[0];
    return path.startsWith("/api") ? path.slice("/api".length) : path;
  }
}
