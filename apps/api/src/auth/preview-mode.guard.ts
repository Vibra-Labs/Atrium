import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../common";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

@Injectable()
export class PreviewModeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (request.previewMode && !SAFE_METHODS.has(request.method)) {
      throw new ForbiddenException("Read-only preview mode");
    }

    return true;
  }
}
