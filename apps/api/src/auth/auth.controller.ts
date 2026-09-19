import { All, Controller, Logger, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { Public } from "../common";
import type { Request, Response } from "express";

// Better Auth authenticates its own routes (sign-in lives here), so this proxy
// is deliberately outside AuthGuard.
@Controller("auth")
@Public()
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

    // Express's body parser has already consumed the raw request stream and
    // parsed it into req.body according to Content-Type. Re-serialize it the
    // same way for Better Auth: the OAuth token endpoint requires a real
    // application/x-www-form-urlencoded body per spec, so JSON.stringify-ing
    // it here (while the Content-Type header still says urlencoded) silently
    // broke every form-encoded request, including the MCP token exchange.
    let requestBody: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = String(req.headers["content-type"] || "");
      requestBody = contentType.includes("application/x-www-form-urlencoded")
        ? new URLSearchParams(req.body as Record<string, string>).toString()
        : JSON.stringify(req.body);
    }

    const webRequest = new globalThis.Request(url, {
      method: req.method,
      headers,
      body: requestBody,
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

    // Never forward Better Auth's own CORS headers: Nest's app-level
    // app.enableCors() already set the correct, credential-safe
    // Access-Control-* headers (echoing the request's actual Origin) before
    // this controller ran. Better Auth sets its own (wildcard) CORS headers
    // on some responses -- e.g. redirects issued mid OAuth-login-resume --
    // which are fine for a top-level navigation but fail any credentialed
    // fetch() call outright, since browsers reject `Access-Control-Allow-
    // Origin: *` together with `credentials: "include"`. Forwarding them
    // here would silently clobber the correct headers already on the
    // response.
    response.headers.forEach((value: string, key: string) => {
      const lower = key.toLowerCase();
      if (lower === "set-cookie" || lower.startsWith("access-control-")) return;
      res.setHeader(key, value);
    });

    const body = await response.text();
    if (body) {
      res.send(body);
    } else {
      res.end();
    }
  }
}
