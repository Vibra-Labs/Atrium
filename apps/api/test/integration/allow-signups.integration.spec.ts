/**
 * The unit tests in auth.service.spec.ts prove `maySignUp` returns the right
 * boolean. They cannot prove the boolean is actually consulted, because the
 * gate lives in a Better Auth `databaseHooks.user.create.before` hook that the
 * mocks never run.
 *
 * These drive the real `/api/auth/sign-up/email` route — the same one
 * /accept-invite posts to, and the route that was open when
 * ALLOW_SIGNUPS=false — against a real database, so the invitation status and
 * expiry filtering is exercised by Postgres rather than asserted on a mock.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { assertDisposableDatabase } from "./guard";
import { AuthService } from "../../src/auth/auth.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { MailService } from "../../src/mail/mail.service";
import type { BillingService } from "../../src/billing/billing.service";

let prisma: PrismaService;
let allowSignups: string | undefined;
let orgId: string;
let inviterId: string;

const config = {
  get: (key: string, fallback?: string) => {
    if (key === "ALLOW_SIGNUPS") return allowSignups;
    if (key === "WEB_URL") return "http://localhost:3000";
    if (key === "API_URL") return "http://localhost:3001";
    return fallback;
  },
  getOrThrow: (key: string) => {
    if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
    throw new Error(`Missing ${key}`);
  },
} as unknown as ConfigService;

const mail = { send: async () => undefined } as unknown as MailService;
const billing = {
  initializeFreePlan: async () => undefined,
} as unknown as BillingService;

function makeAuth(): AuthService {
  return new AuthService(config, prisma, mail, billing);
}

/** Posts to the real Better Auth email signup route. */
async function signUp(
  service: AuthService,
  email: string,
): Promise<{ status: number; body: string }> {
  const res = await service.auth.handler(
    new Request("http://localhost:3001/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3001",
      },
      body: JSON.stringify({
        name: "Test",
        email,
        password: "correct-horse-battery",
      }),
    }),
  );
  return { status: res.status, body: await res.text() };
}

async function createInvitation(
  email: string,
  opts: { status?: string; expiresAt?: Date } = {},
): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.invitation.create({
    data: {
      id: `inv-${stamp}`,
      organizationId: orgId,
      email,
      role: "member",
      status: opts.status ?? "pending",
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
      inviterId,
    },
  });
}

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.invitation.deleteMany({ where: {} });
  await prisma.member.deleteMany({ where: {} });
  await prisma.account.deleteMany({ where: {} });
  await prisma.session.deleteMany({ where: {} });
  await prisma.user.deleteMany({ where: {} });
  await prisma.organization.deleteMany({ where: {} });

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { id: `as-org-${stamp}`, name: "Acme", slug: `as-${stamp}` },
  });
  orgId = org.id;
  const inviter = await prisma.user.create({
    data: {
      id: `as-inviter-${stamp}`,
      name: "Owner",
      email: `owner-${stamp}@acme.test`,
      emailVerified: true,
    },
  });
  inviterId = inviter.id;

  allowSignups = undefined;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("ALLOW_SIGNUPS enforcement on /api/auth/sign-up/email", () => {
  it("lets a stranger sign up on an open deploy", async () => {
    const res = await signUp(makeAuth(), "stranger@example.com");

    expect(res.status).toBe(200);
    expect(
      await prisma.user.findFirst({ where: { email: "stranger@example.com" } }),
    ).not.toBeNull();
  });

  it("refuses an uninvited stranger when signups are disabled", async () => {
    allowSignups = "false";

    const res = await signUp(makeAuth(), "stranger@example.com");

    expect(res.status).toBe(403);
    expect(
      await prisma.user.findFirst({ where: { email: "stranger@example.com" } }),
    ).toBeNull();
  });

  it("still lets an invited client sign up when signups are disabled", async () => {
    allowSignups = "false";
    await createInvitation("client@acme.test");

    const res = await signUp(makeAuth(), "client@acme.test");

    expect(res.status).toBe(200);
    expect(
      await prisma.user.findFirst({ where: { email: "client@acme.test" } }),
    ).not.toBeNull();
  });

  it("matches the invitation regardless of email case", async () => {
    allowSignups = "false";
    await createInvitation("Client@Acme.test");

    const res = await signUp(makeAuth(), "client@acme.test");

    expect(res.status).toBe(200);
  });

  it("refuses when the only invitation has expired", async () => {
    allowSignups = "false";
    await createInvitation("late@acme.test", {
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await signUp(makeAuth(), "late@acme.test");

    expect(res.status).toBe(403);
    expect(
      await prisma.user.findFirst({ where: { email: "late@acme.test" } }),
    ).toBeNull();
  });

  it("refuses when the invitation was already accepted", async () => {
    allowSignups = "false";
    await createInvitation("used@acme.test", { status: "accepted" });

    const res = await signUp(makeAuth(), "used@acme.test");

    expect(res.status).toBe(403);
  });
});
