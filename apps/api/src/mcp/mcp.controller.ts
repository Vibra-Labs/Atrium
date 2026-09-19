import { Controller, Delete, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "../common";
import { McpService } from "./mcp.service";

/**
 * @Public because the handler does its own identity check (it controls the
 * 401 headers MCP clients rely on). @SkipThrottle because the IP-based global
 * limit is replaced by a per-key limit inside McpService. Never takes @Body(),
 * so the global ValidationPipe leaves JSON-RPC payloads alone.
 */
@Controller("mcp")
@Public()
@SkipThrottle()
export class McpController {
  constructor(private mcp: McpService) {}

  @Post()
  @HttpCode(200)
  async post(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.mcp.handle(req, res);
  }

  @Get()
  get(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  @Delete()
  delete(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  private methodNotAllowed(res: Response): void {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This server is stateless; use POST." },
      id: null,
    });
  }
}
