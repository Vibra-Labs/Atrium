import {
  Body,
  Controller,
  Post,
  Res,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { Response } from "express";
import { render } from "@react-email/render";
import { WelcomeEmail } from "@atrium/email";
import { Public } from "../common";
import { AuthService } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { MailService } from "../mail/mail.service";
import { SignupDto } from "./signup.dto";

@Controller("onboarding")
@Public()
export class OnboardingController {
  constructor(
    private authService: AuthService,
    private billingService: BillingService,
    private config: ConfigService,
    private mail: MailService,
    @InjectPinoLogger(OnboardingController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post("signup")
  @Throttle({ default: { ttl: 60000, limit: parseInt(process.env.SIGNUP_THROTTLE_LIMIT || "5", 10) } })
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
      const err: Record<string, unknown> = await signupRes.json().catch(() => ({}));
      this.logger.error(
        { status: signupRes.status, error: err.message, code: err.code },
        "Better Auth signup failed",
      );
      throw new BadRequestException(
        (err.message as string) || "Signup failed",
      );
    }

    // 2. Extract session cookies from signup response
    const setCookies = signupRes.headers.getSetCookie?.() ?? [];
    const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");

    // 3. Create organization using the new session
    const baseSlug = body.orgName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    // Append random suffix to avoid slug collisions from orgs with the same name
    const suffix = Math.random().toString(36).substring(2, 8);
    const slug = `${baseSlug}-${suffix}`;

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
      const orgErr = await orgRes.json().catch(() => ({}));
      this.logger.error(
        { status: orgRes.status, orgErr },
        "Organization creation failed",
      );
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
      .catch((err) => {
        this.logger.warn(
          { err },
          "Failed to send welcome email",
        );
      });

    // 7. Create checkout session for paid plans
    const billingEnabled = this.config.get("BILLING_ENABLED", "false");
    if (billingEnabled === "true" && body.planSlug && body.planSlug !== "free" && orgId) {
      try {
        const successUrl = `${webUrl}/setup?checkout=success`;
        const cancelUrl = `${webUrl}/setup?checkout=cancelled`;
        const result = await this.billingService.createCheckoutSession(
          orgId,
          body.planSlug,
          successUrl,
          cancelUrl,
        );
        return { success: true, checkoutUrl: result.url };
      } catch (err) {
        this.logger.warn(
          { err, planSlug: body.planSlug, orgId },
          "Failed to create checkout session during signup, falling back to free plan",
        );
      }
    }

    return { success: true };
  }
}
