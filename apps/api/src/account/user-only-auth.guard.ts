import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

/**
 * A guard that only requires the user to be authenticated.
 * Unlike the default AuthGuard, this does NOT require an active organization context.
 * Used for account-level operations like account deletion.
 */
@Injectable()
export class UserOnlyAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    if (!request.user) {
      throw new UnauthorizedException("Authentication required");
    }

    return true;
  }
}
