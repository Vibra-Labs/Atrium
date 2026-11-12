import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { isPrivilegedRole } from "../common/helpers/privileged-role";
import type { AuthenticatedRequest } from "../common";
import { canonicalPath, parseOriginalUrl } from "../auth/staff-only-org-routes";
import { gateDecision, hasSecondFactor, isCrossWorkspaceRoute, isOpenRoute } from "./second-factor";
import type { GateRefusal } from "./second-factor";

const AUTH_PREFIX: string = "/api/auth";

const MESSAGES: Record<GateRefusal, string> = {
  SECOND_FACTOR_REQUIRED: "Confirm it's you with your second factor to continue.",
  TWO_FACTOR_REQUIRED: "Your workspace requires two-factor authentication. Set it up to continue.",
};

type GateRequest = Partial<
  Pick<
    AuthenticatedRequest,
    | "user"
    | "session"
    | "member"
    | "bearerKind"
    | "previewMode"
    | "workspaceRequiresTwoFactor"
    | "staffInRequiringWorkspace"
    | "sessionLookupFailed"
  >
> &
  Pick<Request, "originalUrl">;

/** The route as gateDecision names it: "auth:/x" for Better Auth, the canonical path otherwise. */
function gateRoute(originalUrl: string): { route: string; isAuthProxy: boolean } {
  const path: string = canonicalPath(parseOriginalUrl(originalUrl).pathname);
  if (path === AUTH_PREFIX || path.startsWith(`${AUTH_PREFIX}/`)) {
    return { route: `auth:${path.slice(AUTH_PREFIX.length)}`, isAuthProxy: true };
  }
  return { route: path, isAuthProxy: false };
}

/**
 * Global guard for the session rule in the sign-in security spec. Runs on
 * every controller, the Better Auth proxy included, so no Better Auth route
 * is reachable from a session that has not passed its second factor.
 */
@Injectable()
export class SecondFactorGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req: GateRequest = context.switchToHttp().getRequest<GateRequest>();
    // API keys and MCP tokens are not sessions; they can only be created from a verified one.
    if (req.bearerKind) return true;
    const { route, isAuthProxy } = gateRoute(req.originalUrl);
    // The proxy authenticates by itself, so a cookie we could not check must not reach it.
    if (!req.user && req.sessionLookupFailed && isAuthProxy && !isOpenRoute(route)) {
      throw new ServiceUnavailableException("Could not check your session. Try again in a moment.");
    }
    if (!req.user || !req.session) return true;

    const isPublic: boolean | undefined = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Public routes other than the proxy do not act as the signed-in user.
    if (isPublic && !isAuthProxy) return true;

    // Only staff can preview as a client, and preview swaps the role to the client's.
    const isStaff: boolean = req.previewMode === true || isPrivilegedRole(req.member?.role);
    const hasFactor: boolean = hasSecondFactor(req.user);
    const refusal: GateRefusal | null = gateDecision({
      route,
      hasFactor,
      secondFactor: req.session.secondFactor ?? null,
      enrollmentOwed:
        !hasFactor &&
        ((req.workspaceRequiresTwoFactor === true && isStaff) ||
          // Better Auth's organization routes accept any organizationId, so
          // owing setup in any workspace counts there, whichever is active.
          (isCrossWorkspaceRoute(route) && req.staffInRequiringWorkspace === true)),
    });
    if (refusal) throw new ForbiddenException({ code: refusal, message: MESSAGES[refusal] });
    return true;
  }
}
