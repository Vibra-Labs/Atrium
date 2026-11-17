import { describe, expect, it, mock, beforeEach } from "bun:test";
import "../common/testing/mock-email";
import { NotFoundException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { MailService } from "../mail/mail.service";
import type { BillingService } from "../billing/billing.service";

type SignInCall = {
  body: { email: string; name?: string; callbackURL: string; errorCallbackURL: string };
};

let demoMode: string | undefined = "true";
let ownerEmail: string | undefined = "owner@demo.invalid";
let clientEmail: string | undefined = "client@demo.invalid";

const mockConfig = {
  get: mock((key: string, fallback?: string) => {
    if (key === "WEB_URL") return "http://localhost:3000";
    if (key === "API_URL") return "http://localhost:3001";
    if (key === "DEMO_MODE") return demoMode;
    if (key === "DEMO_OWNER_EMAIL") return ownerEmail;
    if (key === "DEMO_CLIENT_EMAIL") return clientEmail;
    return fallback;
  }),
  getOrThrow: mock((key: string) => {
    if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
    throw new Error(`Missing ${key}`);
  }),
};

const mockPrisma = {
  user: { findFirst: mock((): Promise<unknown> => Promise.resolve({ id: "u-demo" })) },
  member: { findFirst: mock((): Promise<unknown> => Promise.resolve(null)) },
  organization: { findUnique: mock((): Promise<unknown> => Promise.resolve(null)) },
};

const mockMail = { send: mock(() => Promise.resolve({ sent: true, viaOrgConfig: false })) };

function makeService(): AuthService {
  return new AuthService(
    mockConfig as unknown as ConfigService,
    mockPrisma as unknown as PrismaService,
    mockMail as unknown as MailService,
    {} as unknown as BillingService,
    {} as never,
  );
}

describe("AuthService.startDemoSignIn", () => {
  let service: AuthService;

  /** Stands in for Better Auth: hands the verify URL to deliverMagicLink, as the plugin does. */
  function stubSignInMagicLink(): ReturnType<typeof mock> {
    const signInMagicLink = mock(async (call: SignInCall) => {
      await service.deliverMagicLink(
        call.body.email,
        `http://localhost:3001/api/auth/magic-link/verify?token=tok-demo&callbackURL=${encodeURIComponent(call.body.callbackURL)}`,
      );
    });
    (service.auth as unknown as { api: { signInMagicLink: typeof signInMagicLink } }).api.signInMagicLink =
      signInMagicLink;
    return signInMagicLink;
  }

  beforeEach(() => {
    demoMode = "true";
    ownerEmail = "owner@demo.invalid";
    clientEmail = "client@demo.invalid";
    mockMail.send.mockClear();
    service = makeService();
  });

  it("throws NotFoundException when demo mode is off", async () => {
    demoMode = undefined;
    service = makeService();
    const signIn = stubSignInMagicLink();

    await expect(service.startDemoSignIn("owner")).rejects.toThrow(NotFoundException);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("returns a captured magic-link URL for the owner address", async () => {
    const signIn = stubSignInMagicLink();

    const result = await service.startDemoSignIn("owner");

    expect(result.url).toContain("http://localhost:3001/api/auth/magic-link/verify?token=tok-demo");
    expect((signIn.mock.calls[0][0] as SignInCall).body.email).toBe("owner@demo.invalid");
  });

  it("sends no email", async () => {
    stubSignInMagicLink();

    await service.startDemoSignIn("owner");

    expect(mockMail.send).not.toHaveBeenCalled();
  });

  it("throws when the configured address for the kind is missing", async () => {
    clientEmail = undefined;
    service = makeService();
    const signIn = stubSignInMagicLink();

    await expect(service.startDemoSignIn("client")).rejects.toThrow(NotFoundException);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("requests a callbackURL of /dashboard for owner and /portal for client", async () => {
    const signIn = stubSignInMagicLink();

    await service.startDemoSignIn("owner");
    expect((signIn.mock.calls[0][0] as SignInCall).body.callbackURL).toBe(
      "http://localhost:3000/dashboard",
    );

    await service.startDemoSignIn("client");
    expect((signIn.mock.calls[1][0] as SignInCall).body.callbackURL).toBe(
      "http://localhost:3000/portal",
    );
  });

  it("refuses an address that is not a configured demo address", async () => {
    // Guards the one real risk of this method: it must never become sign-in-as-anyone.
    ownerEmail = "edgar@vibralabs.co";
    service = makeService();
    const signIn = stubSignInMagicLink();

    await expect(service.startDemoSignIn("owner")).rejects.toThrow(NotFoundException);
    expect(signIn).not.toHaveBeenCalled();
  });
});
