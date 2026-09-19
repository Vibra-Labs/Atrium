import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { McpAuthService } from "./mcp-auth.service";
import { McpConsentController, McpGrantsController } from "./mcp-grants.controller";
import { OAuthCleanupTask } from "./oauth-cleanup.task";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [McpConsentController, McpGrantsController],
  providers: [McpAuthService, OAuthCleanupTask],
  exports: [McpAuthService],
})
export class McpAuthModule {}
