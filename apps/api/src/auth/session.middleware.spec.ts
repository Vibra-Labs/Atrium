import { describe, expect, it, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import { SessionMiddleware } from "./session.middleware";
import type { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";

const COOKIE_NAME = "wos-session";
const COOKIE_PASSWORD = "x".repeat(32);

const WORKOS_USER = {
  object: "user" as const,
  id: "user_workos_123",
  email: "chris@pexlo.com",
};

const PRISMA_USER = {
  id: "local_user_1",
  email: "chris@pexlo.com",
  workosUserId: "user_workos_123",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const MEMBERSHIP = {
  id: "member_1",
  userId: "local_user_1",
  organizationId: "org_1",
  organization: { id: "org_1", name: "Pexlo", members: [] },
};

interface SealedSessionStub {
  authenticate: ReturnType<typeof mock>;
  refresh: ReturnType<typeof mock>;
}

function makeHarness(opts: {
  sealedSession: SealedSessionStub;
  cookies?: Record<string, string>;
  user?: typeof PRISMA_USER | null;
  memberships?: (typeof MEMBERSHIP)[];
}) {
  const loadSealedSession = mock(() => opts.sealedSession);

  const authService = {
    getWorkOSCookieName: () => COOKIE_NAME,
    getWorkOSCookiePassword: () => COOKIE_PASSWORD,
    workos: { userManagement: { loadSealedSession } },
  } as unknown as AuthService;

  const prisma = {
    user: { findFirst: mock(() => Promise.resolve(opts.user ?? PRISMA_USER)) },
    member: {
      findMany: mock(() => Promise.resolve(opts.memberships ?? [MEMBERSHIP])),
    },
  } as unknown as PrismaService;

  const middleware = new SessionMiddleware(authService, prisma);

  const req = {
    cookies: opts.cookies ?? { [COOKIE_NAME]: "sealed-cookie-value" },
    ip: "127.0.0.1",
    get: () => "test-agent",
  } as unknown as Request & {
    user?: unknown;
    session?: unknown;
    organization?: unknown;
  };

  const setCookie = mock((_n: string, _v: string, _o: unknown) => {});
  const res = { cookie: setCookie } as unknown as Response;
  const next = mock(() => {}) as unknown as NextFunction;

  return { middleware, req, res, next, setCookie, loadSealedSession };
}

describe("SessionMiddleware", () => {
  it("populates req.user when the access token is still valid", async () => {
    const sealedSession: SealedSessionStub = {
      authenticate: mock(() =>
        Promise.resolve({
          authenticated: true,
          user: WORKOS_USER,
          sessionId: "session_abc",
        }),
      ),
      refresh: mock(() => Promise.resolve({ authenticated: false })),
    };
    const h = makeHarness({ sealedSession });

    await h.middleware.use(h.req, h.res, h.next);

    expect(h.req.user).toBeDefined();
    expect((h.req.user as { id: string }).id).toBe("local_user_1");
    expect((h.req.organization as { id: string }).id).toBe("org_1");
    // No refresh needed → no cookie rewrite.
    expect(sealedSession.refresh).not.toHaveBeenCalled();
    expect(h.setCookie).not.toHaveBeenCalled();
  });

  it("refreshes and re-seals the cookie when the access token is expired", async () => {
    const sealedSession: SealedSessionStub = {
      authenticate: mock(() =>
        Promise.resolve({
          authenticated: false,
          reason: "invalid_jwt",
        }),
      ),
      refresh: mock(() =>
        Promise.resolve({
          authenticated: true,
          sealedSession: "new-sealed-cookie-value",
          user: WORKOS_USER,
          sessionId: "session_refreshed",
        }),
      ),
    };
    const h = makeHarness({ sealedSession });

    await h.middleware.use(h.req, h.res, h.next);

    // Refresh attempted and new sealed session written back to the response.
    expect(sealedSession.refresh).toHaveBeenCalledTimes(1);
    expect(h.setCookie).toHaveBeenCalledTimes(1);
    const [name, value] = h.setCookie.mock.calls[0];
    expect(name).toBe(COOKIE_NAME);
    expect(value).toBe("new-sealed-cookie-value");
    // Request is authenticated with the refreshed identity.
    expect((h.req.user as { id: string }).id).toBe("local_user_1");
    expect((h.req.session as { id: string }).id).toBe("session_refreshed");
  });

  it("leaves req.user unset when refresh fails (expired/revoked)", async () => {
    const sealedSession: SealedSessionStub = {
      authenticate: mock(() =>
        Promise.resolve({ authenticated: false, reason: "invalid_jwt" }),
      ),
      refresh: mock(() =>
        Promise.resolve({ authenticated: false, reason: "invalid_grant" }),
      ),
    };
    const h = makeHarness({ sealedSession });

    await h.middleware.use(h.req, h.res, h.next);

    expect(h.req.user).toBeUndefined();
    expect(h.setCookie).not.toHaveBeenCalled();
    expect(h.next).toHaveBeenCalled();
  });

  it("does nothing when no session cookie is present", async () => {
    const sealedSession: SealedSessionStub = {
      authenticate: mock(() => Promise.resolve({ authenticated: false })),
      refresh: mock(() => Promise.resolve({ authenticated: false })),
    };
    const h = makeHarness({ sealedSession, cookies: {} });

    await h.middleware.use(h.req, h.res, h.next);

    expect(h.req.user).toBeUndefined();
    expect(sealedSession.authenticate).not.toHaveBeenCalled();
    expect(h.next).toHaveBeenCalled();
  });
});
