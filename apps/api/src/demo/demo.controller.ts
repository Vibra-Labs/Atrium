import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../common";
import { AuthService } from "../auth/auth.service";
import { DemoService } from "./demo.service";
import { DemoEnterDto } from "./demo.dto";

/**
 * Entry into the public demo workspace. Public because a demo visitor has no
 * session yet, and 404 rather than 403 when demo mode is off so an ordinary
 * install does not advertise that this exists.
 *
 * Entry is a POST on purpose. Link prefetchers, mail scanners and chat-app
 * link previews all fetch GET links, and each fetch would spend a sign-in link
 * and count as a visit; the web app's /demo page posts here on the visitor's
 * behalf.
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
  @HttpCode(302)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async enter(@Body() body: DemoEnterDto, @Res() res: Response): Promise<void> {
    this.assertEnabled();
    const { url } = await this.authService.startDemoSignIn(body.kind);
    this.demo.touch();
    res.redirect(302, url);
  }
}
