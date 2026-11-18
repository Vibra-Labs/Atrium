import {
  BadRequestException,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../common";
import { AuthService } from "../auth/auth.service";
import { DemoService } from "./demo.service";
import type { DemoKind } from "./demo-config";

/**
 * Entry into the public demo workspace. Public because a demo visitor has no
 * session yet, and 404 rather than 403 when demo mode is off so an ordinary
 * install does not advertise that this exists.
 *
 * Entry is a POST on purpose. Link prefetchers, mail scanners and chat-app
 * link previews all fetch GET links, and each fetch would spend a sign-in link
 * and count as a visit; the web app's /demo page submits a form here on the
 * visitor's behalf.
 *
 * A form submission, not fetch(): this responds with a redirect chain that ends
 * on the web app's origin, and the browser will not let a cross-origin fetch
 * follow a redirect to an origin that answers without CORS headers. A top-level
 * form navigation is not subject to CORS at all, and carries the cookies the
 * chain sets. The kind travels in the query string so no body parsing is
 * involved either way.
 */
@Controller("demo")
@Public()
export class DemoController {
  constructor(
    private authService: AuthService,
    private demo: DemoService,
  ) {}

  private assertEnabled(): void {
    if (!this.demo.enabled) throw new NotFoundException("Not found");
  }

  @Post("enter")
  @HttpCode(303)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async enter(@Query("kind") kind: DemoKind, @Res() res: Response): Promise<void> {
    this.assertEnabled();
    if (kind !== "owner" && kind !== "client") {
      throw new BadRequestException("Unknown demo kind");
    }
    const { url } = await this.authService.startDemoSignIn(kind);
    this.demo.touch();
    // 303 rather than 302: it is the one redirect every client must follow with
    // a GET, and the magic-link verify endpoint is GET-only. Browsers and fetch
    // downgrade a 302 after POST anyway, but curl does not — and neither do
    // some HTTP clients, which would turn entry into a silent 404.
    res.redirect(303, url);
  }
}
