import { Module } from "@nestjs/common";
import { McpAuthService } from "./mcp-auth.service";
import { McpConsentController, McpGrantsController } from "./mcp-grants.controller";

@Module({
  controllers: [McpConsentController, McpGrantsController],
  providers: [McpAuthService],
  exports: [McpAuthService],
})
export class McpAuthModule {}
