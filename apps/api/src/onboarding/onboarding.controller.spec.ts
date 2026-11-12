import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import type { AuthService } from "../auth/auth.service";
import type { BillingService } from "../billing/billing.service";
import type { MailService } from "../mail/mail.service";
import type { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import type { SignupDto } from "./signup.dto";

const makeConfig = (vals: Record<string, string> = {}) =>
  ({ get: (key: string, def?: string) => vals[key] ?? def }) as unknown as ConfigService;

const makeLogger = () =>
  ({ error: mock(() => {}), warn: mock(() => {}), info: mock(() => {}) }) as unknown as never;

const makeRes = () =>
  ({ append: mock(() => {}), status: mock(() => {}) }) as unknown as Response;

const body: SignupDto = {
  name: "A",
  email: "a@b.com",
  password: "TestPass123!",
  orgName: "Acme",
} as SignupDto;

describe("OnboardingController signup gate", () => {
  it("throws ForbiddenException and never calls auth when ALLOW_SIGNUPS is false", async () => {
    const handler = mock(() => Promise.resolve(new Response()));
    const authService = { auth: { handler } } as unknown as AuthService;
    const controller = new OnboardingController(
      authService,
      {} as BillingService,
      makeConfig({ ALLOW_SIGNUPS: "false" }),
      {} as MailService,
      makeLogger(),
    );

    await expect(controller.signup(body, makeRes())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the gate (reaches Better Auth) when ALLOW_SIGNUPS is unset", async () => {
    const handler = mock(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: async () => ({ message: "boom" }),
        headers: { getSetCookie: () => [] },
      } as unknown as Response),
    );
    const authService = { auth: { handler } } as unknown as AuthService;
    const controller = new OnboardingController(
      authService,
      {} as BillingService,
      makeConfig(), // ALLOW_SIGNUPS unset -> defaults to enabled
      {} as MailService,
      makeLogger(),
    );

    await expect(controller.signup(body, makeRes())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingController checkout from the pricing page", () => {
  function okResponse(json: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => json,
      headers: { getSetCookie: () => ["session=abc; Path=/"] },
    } as unknown as Response;
  }

  it("records the checkout as the early plan offer", async () => {
    const handler = mock((req: Request) =>
      Promise.resolve(okResponse(req.url.endsWith("/organization/create") ? { id: "org-1" } : {})),
    );
    const billing = { createCheckoutSession: mock(() => Promise.resolve({ url: "https://stripe.test/c" })) };
    const planOffers = { recordSignupCheckout: mock((): Promise<void> => Promise.resolve()) };
    const controller = new OnboardingController(
      { auth: { handler } } as unknown as AuthService,
      billing as unknown as BillingService,
      makeConfig({ BILLING_ENABLED: "true" }),
      { send: mock(() => Promise.resolve({ sent: true })) } as unknown as MailService,
      makeLogger(),
      planOffers as never,
    );

    const result = await controller.signup({ ...body, planSlug: "pro" } as SignupDto, makeRes());
    expect(result).toEqual({ success: true, checkoutUrl: "https://stripe.test/c" });
    expect(planOffers.recordSignupCheckout).toHaveBeenCalledWith("org-1");
  });
});
