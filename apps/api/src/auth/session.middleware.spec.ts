import { describe, expect, it, mock } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { SessionMiddleware } from "./session.middleware";

const resolved = {
  apiKeyId: "k1",
  user: { id: "u1", name: "Ada", email: "a@t.co", emailVerified: true, image: null, createdAt: new Date(), updatedAt: new Date() },
  organization: { id: "org1", name: "Acme", slug: null, logo: null, createdAt: new Date(), updatedAt: new Date(), metadata: null },
  member: { id: "m1", userId: "u1", organizationId: "org1", role: "owner", createdAt: new Date() },
};

function build(resolveResult: unknown = resolved) {
  const getSession = mock(() => Promise.resolve(null));
  const authService = { auth: { api: { getSession } } };
  const apiKeys = { resolve: mock(() => Promise.resolve(resolveResult)) };
  const mw = new SessionMiddleware(authService as never, apiKeys as never);
  return { mw, getSession, apiKeys };
}

function req(headers: Record<string, string>, cookies: Record<string, string> = {}): Request {
  return { headers, cookies, originalUrl: "/api/projects" } as unknown as Request;
}

describe("SessionMiddleware bearer branch", () => {
  it("populates the request from a valid API key", async () => {
    const { mw, getSession } = build();
    const r = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(r, {} as Response, next);

    expect(r.user.id).toBe("u1");
    expect(r.organization.id).toBe("org1");
    expect(r.member.role).toBe("owner");
    expect(r.session.activeOrganizationId).toBe("org1");
    expect(r.apiKeyId).toBe("k1");
    expect(getSession).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("caches a resolved key for subsequent requests", async () => {
    const { mw, apiKeys } = build();
    const next = mock(() => {}) as unknown as NextFunction;
    await mw.use(req({ authorization: "Bearer atr_abc" }), {} as Response, next);
    await mw.use(req({ authorization: "Bearer atr_abc" }), {} as Response, next);
    expect(apiKeys.resolve).toHaveBeenCalledTimes(1);
  });

  it("leaves the request unauthenticated for an invalid key", async () => {
    const { mw } = build(null);
    const r = req({ authorization: "Bearer atr_bad" }) as Request & Record<string, any>;
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(r, {} as Response, next);

    expect(r.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignores the key when a session cookie is present", async () => {
    const { mw, apiKeys, getSession } = build();
    const r = req({ authorization: "Bearer atr_abc" }, { "better-auth.session_token": "s1" });
    await mw.use(r, {} as Response, mock(() => {}) as unknown as NextFunction);
    expect(apiKeys.resolve).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("ignores bearer tokens that are not Atrium keys", async () => {
    const { mw, apiKeys } = build();
    await mw.use(req({ authorization: "Bearer eyJhbGciOi" }), {} as Response, mock(() => {}) as unknown as NextFunction);
    expect(apiKeys.resolve).not.toHaveBeenCalled();
  });
});
