import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedRequest } from "../common";

const HEADER_NAME = "x-preview-as";
const PRIVILEGED_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class PreviewModeMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authReq = req as AuthenticatedRequest;
    const headerValue = req.headers[HEADER_NAME];
    const targetUserId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!targetUserId) {
      next();
      return;
    }

    const requesterRole = authReq.member?.role;
    const orgId = authReq.organization?.id;

    if (!requesterRole || !orgId || !PRIVILEGED_ROLES.has(requesterRole)) {
      throw new UnauthorizedException("Preview unavailable");
    }

    const targetMember = await this.prisma.member.findFirst({
      where: { userId: targetUserId, organizationId: orgId },
      select: { userId: true, role: true, organizationId: true },
    });

    if (!targetMember || targetMember.role !== "member") {
      throw new UnauthorizedException("Preview unavailable");
    }

    // Shallow-clone so we never mutate the SessionMiddleware cache.
    authReq.user = { ...authReq.user, id: targetMember.userId };
    authReq.previewMode = true;
    next();
  }
}
