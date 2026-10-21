/**
 * SessionMiddleware against a real database: in a workspace with more members
 * than Better Auth's default page (100), the owner and the newest members must
 * still resolve with their own role. Sessions are real Better Auth sessions
 * (signed cookie, verified by getSession); only the users are inserted directly.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHmac } from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { ConfigService } from "@nestjs/config";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { AuthService } from "../../src/auth/auth.service";
import { SessionMiddleware } from "../../src/auth/session.middleware";
import type { AuthenticatedRequest } from "../../src/common";

const SECRET: string = "x".repeat(32);
const MEMBER_COUNT = 150;
const stamp: string = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const orgId: string = `sm-org-${stamp}`;

const config = {
  get: (key: string, fallback?: string): string | undefined => {
    if (key === "WEB_URL") return "http://localhost:3000";
    if (key === "API_URL") return "http://localhost:3001";
    return fallback;
  },
  getOrThrow: (key: string): string => {
    if (key === "BETTER_AUTH_SECRET") return SECRET;
    throw new Error(`Missing ${key}`);
  },
} as unknown as ConfigService;

let prisma: PrismaService;
let middleware: SessionMiddleware;

/** Cookie value Better Auth sets for a session token (better-call signCookieValue). */
function signedCookie(token: string): string {
  const signature: string = createHmac("sha256", SECRET).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * Zero-padded so id order matches creation order: Better Auth's unordered
 * 100-row page then holds the first 100 members, and the ones under test
 * (created last) fall outside it however Postgres orders the rows.
 */
function pad(index: number): string {
  return String(index).padStart(3, "0");
}

function userIdFor(index: number): string {
  return `sm-user-${stamp}-${pad(index)}`;
}

/** Inserts a user, their membership and a session on this workspace; returns the cookie value. */
async function addMember(index: number, role: string): Promise<string> {
  const userId: string = userIdFor(index);
  const token: string = `smtoken${stamp.replace(/[^a-z0-9]/gi, "")}${pad(index)}`;
  await prisma.user.create({ data: { id: userId, name: `User ${index}`, email: `${userId}@test.com` } });
  await prisma.member.create({ data: { id: `sm-member-${stamp}-${pad(index)}`, organizationId: orgId, userId, role } });
  await prisma.session.create({
    data: {
      id: `sm-session-${stamp}-${index}`,
      token,
      userId,
      activeOrganizationId: orgId,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return signedCookie(token);
}

async function resolve(cookie: string): Promise<Partial<AuthenticatedRequest>> {
  const req = {
    headers: { cookie: `better-auth.session_token=${cookie}` },
    cookies: { "better-auth.session_token": decodeURIComponent(cookie) },
    ip: "127.0.0.1",
    originalUrl: "/api/projects",
  } as unknown as Request;
  await middleware.use(req, {} as Response, (() => undefined) as NextFunction);
  return req as Partial<AuthenticatedRequest>;
}

let ownerCookie: string;
let lastMemberCookie: string;

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  const auth: AuthService = new AuthService(config, prisma, {} as never, {} as never, {} as never);
  middleware = new SessionMiddleware(
    auth,
    {} as never,
    {} as never,
    config,
    { touch: async (): Promise<void> => undefined } as never,
    prisma,
  );

  await prisma.organization.create({ data: { id: orgId, name: `sm-${stamp}`, slug: `sm-${stamp}` } });
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const cookie: string = await addMember(i, "member");
    if (i === MEMBER_COUNT) lastMemberCookie = cookie;
  }
  // The owner is created last, after 150 client members.
  ownerCookie = await addMember(MEMBER_COUNT + 1, "owner");
}, 60_000);

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch((e: unknown) => console.error(e));
  await prisma.user
    .deleteMany({ where: { id: { startsWith: `sm-user-${stamp}-` } } })
    .catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

describe("SessionMiddleware in a workspace with more than 100 members (Postgres)", () => {
  it("resolves the owner, created last, as owner", async () => {
    const req: Partial<AuthenticatedRequest> = await resolve(ownerCookie);
    expect(req.user?.id).toBe(userIdFor(MEMBER_COUNT + 1));
    expect(req.organization?.id).toBe(orgId);
    expect(req.member?.role).toBe("owner");
  });

  it("resolves client member #150 as member", async () => {
    const req: Partial<AuthenticatedRequest> = await resolve(lastMemberCookie);
    expect(req.organization?.id).toBe(orgId);
    expect(req.member?.userId).toBe(userIdFor(MEMBER_COUNT));
    expect(req.member?.role).toBe("member");
  });
});
