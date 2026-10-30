import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { WellKnownController } from "./well-known.controller";
import { InvitationsController } from "./invitations.controller";
import { SignInOptionsController } from "./sign-in-options.controller";
import { AuthService } from "./auth.service";
import { SessionMiddleware } from "./session.middleware";
import { PreviewModeMiddleware } from "./preview-mode.middleware";
import { LastSeenTracker } from "./last-seen.tracker";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { MailModule } from "../mail/mail.module";
import { BillingModule } from "../billing/billing.module";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { AuthCleanupTask } from "./auth-cleanup.task";
import { McpAuthModule } from "../mcp-auth/mcp-auth.module";

@Module({
  imports: [ContactSyncModule, MailModule, BillingModule, ApiKeysModule, McpAuthModule],
  controllers: [AuthController, WellKnownController, InvitationsController, SignInOptionsController],
  providers: [AuthService, SessionMiddleware, PreviewModeMiddleware, LastSeenTracker, AuthCleanupTask],
  exports: [AuthService, SessionMiddleware, PreviewModeMiddleware, LastSeenTracker],
})
export class AuthModule {}
