import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

const TWO_FACTOR_AUTH_PATH_PREFIX = "/api/auth/two-factor/";
const STAFF_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class TwoFactorEnforcementGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const url: string = request.originalUrl ?? "";

    // Allow Better Auth's two-factor endpoints so users can enroll while
    // being forced to enroll.
    if (url.startsWith(TWO_FACTOR_AUTH_PATH_PREFIX)) return true;

    // No user yet — AuthGuard will reject. Don't double up.
    if (!request.user || !request.member || !request.organization) return true;

    // Clients are never forced.
    if (!STAFF_ROLES.has(request.member.role)) return true;

    // Already enrolled.
    if (request.user.twoFactorEnabled === true) return true;

    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: request.organization.id },
      select: { requireTwoFactor: true },
    });

    if (!settings?.requireTwoFactor) return true;

    throw new ForbiddenException({
      code: "TWO_FACTOR_REQUIRED",
      message: "Your organization requires two-factor authentication. Please enroll to continue.",
    });
  }
}
