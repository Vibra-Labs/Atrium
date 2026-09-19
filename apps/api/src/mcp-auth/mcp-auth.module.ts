import { Module } from "@nestjs/common";
import { McpAuthService } from "./mcp-auth.service";

@Module({
  providers: [McpAuthService],
  exports: [McpAuthService],
})
export class McpAuthModule {}
