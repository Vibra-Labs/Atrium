import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest, AuthUser, AuthSession, FullOrganization, OrgMember } from "../common";

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private authService: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const authReq = req as Partial<
      Pick<AuthenticatedRequest, "user" | "session" | "organization" | "member">
    > &
      Request;

    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
      }

      const session = await this.authService.auth.api.getSession({
        headers,
      });

      if (session) {
        authReq.user = session.user as AuthUser;
        authReq.session = session.session as AuthSession;
      }

      const activeOrgId = (
        session?.session as { activeOrganizationId?: string } | undefined
      )?.activeOrganizationId;
      if (activeOrgId) {
        const getFullOrg = (
          this.authService.auth.api as unknown as Record<
            string,
            | ((opts: { headers: Headers }) => Promise<FullOrganization | null>)
            | undefined
          >
        ).getFullOrganization;
        if (getFullOrg) {
          const orgData = await getFullOrg({ headers });

          if (orgData) {
            authReq.organization = orgData as FullOrganization;
            const member = orgData.members?.find(
              (m: OrgMember) => m.userId === session!.user.id,
            );
            if (member) {
              authReq.member = member;
            }
          }
        }
      }
    } catch {
      // Session resolution failed — continue without auth.
      // The AuthGuard will reject unauthenticated requests.
    }

    next();
  }
}
