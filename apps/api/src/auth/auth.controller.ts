import { All, Controller, Logger, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import type { Request, Response } from "express";

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly publicOrigin: string;

  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {
    this.publicOrigin = (
      this.config.get("BETTER_AUTH_URL") ||
      this.config.get("API_URL") ||
      "http://localhost:3001"
    ).replace(/\/$/, "");
  }

  @All("*path")
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    const url = `${this.publicOrigin}${req.originalUrl}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
    }

    this.logger.log(`${req.method} ${req.originalUrl}`);

    const webRequest = new globalThis.Request(url, {
      method: req.method,
      headers,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : undefined,
    });

    const response = await this.authService.handleRequest(webRequest);

    // Convert Web API Response back to Express
    res.status(response.status);

    // Collect Set-Cookie headers individually to avoid overwrite
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];

    if (setCookies.length > 0) {
      res.setHeader("set-cookie", setCookies);
    }

    response.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== "set-cookie") {
        res.setHeader(key, value);
      }
    });

    const body = await response.text();
    if (body) {
      res.send(body);
    } else {
      res.end();
    }
  }
}
