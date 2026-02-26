import {
  Body,
  Controller,
  Post,
  Res,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { render } from "@react-email/render";
import { WelcomeEmail } from "@atrium/email";
import { AuthService } from "../auth/auth.service";
import { MailService } from "../mail/mail.service";
import { SignupDto } from "./signup.dto";

@Controller("onboarding")
export class OnboardingController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  @Post("signup")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async signup(
    @Body() body: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const baseUrl = this.config.get(
      "BETTER_AUTH_URL",
      "http://localhost:3001",
    );

    // 1. Create user via Better Auth
    const signupReq = new globalThis.Request(
      `${baseUrl}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
        body: JSON.stringify({
          name: body.name,
          email: body.email,
          password: body.password,
        }),
      },
    );

    const signupRes = await this.authService.auth.handler(signupReq);

    if (!signupRes.ok) {
      const err = await signupRes.json().catch(() => ({}));
      throw new BadRequestException(
        (err as any).message || "Signup failed",
      );
    }

    // 2. Extract session cookies from signup response
    const setCookies = signupRes.headers.getSetCookie?.() ?? [];
    const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");

    // 3. Create organization using the new session
    const slug = body.orgName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const orgReq = new globalThis.Request(
      `${baseUrl}/api/auth/organization/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
          Cookie: cookieStr,
        },
        body: JSON.stringify({ name: body.orgName, slug }),
      },
    );

    const orgRes = await this.authService.auth.handler(orgReq);

    // Collect all cookies to forward
    const allCookies = [...setCookies];
    for (const cookie of orgRes.headers.getSetCookie?.() ?? []) {
      allCookies.push(cookie);
    }

    if (!orgRes.ok) {
      for (const cookie of allCookies) {
        res.append("Set-Cookie", cookie);
      }
      res.status(207);
      return {
        success: false,
        message:
          "Account created but organization setup failed. Please sign in to continue.",
      };
    }

    // 4. Set the new org as active
    const orgData = await orgRes.json().catch(() => null);
    const orgId = orgData?.id;
    const updatedCookieStr = allCookies
      .map((c: string) => c.split(";")[0])
      .join("; ");

    if (orgId) {
      const setActiveReq = new globalThis.Request(
        `${baseUrl}/api/auth/organization/set-active`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: baseUrl,
            Cookie: updatedCookieStr,
          },
          body: JSON.stringify({ organizationId: orgId }),
        },
      );

      const setActiveRes =
        await this.authService.auth.handler(setActiveReq);
      for (const cookie of setActiveRes.headers.getSetCookie?.() ?? []) {
        allCookies.push(cookie);
      }
    }

    // 5. Forward all cookies to client
    for (const cookie of allCookies) {
      res.append("Set-Cookie", cookie);
    }

    // 6. Send welcome email (fire and forget)
    const webUrl = this.config.get("WEB_URL", "http://localhost:3000");
    render(
      WelcomeEmail({
        name: body.name,
        organizationName: body.orgName,
        portalUrl: `${webUrl}/dashboard`,
      }),
    )
      .then((html) =>
        this.mail.send(
          body.email,
          `Welcome to ${body.orgName}`,
          html,
        ),
      )
      .catch(() => {
        // Silently ignore — welcome email is non-critical
      });

    return { success: true };
  }
}
