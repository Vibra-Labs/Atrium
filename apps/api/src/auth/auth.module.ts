import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { WellKnownController } from "./well-known.controller";
import { AuthService } from "./auth.service";
import { SessionMiddleware } from "./session.middleware";
import { PreviewModeMiddleware } from "./preview-mode.middleware";
import { LastSeenTracker } from "./last-seen.tracker";
import { MailModule } from "../mail/mail.module";
import { BillingModule } from "../billing/billing.module";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { McpAuthModule } from "../mcp-auth/mcp-auth.module";

@Module({
  imports: [MailModule, BillingModule, ApiKeysModule, McpAuthModule],
  controllers: [AuthController, WellKnownController],
  providers: [AuthService, SessionMiddleware, PreviewModeMiddleware, LastSeenTracker],
  exports: [AuthService, SessionMiddleware, PreviewModeMiddleware, LastSeenTracker],
})
export class AuthModule {}
