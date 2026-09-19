import { describe, expect, it, mock } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { SessionMiddleware } from "./session.middleware";
import { hashApiKey } from "../api-keys/api-keys.service";

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

function req(
  headers: Record<string, string>,
  cookies: Record<string, string> = {},
  ip = "10.0.0.1",
): Request {
  return { headers, cookies, ip, originalUrl: "/api/projects" } as unknown as Request;
}

const noop = (): NextFunction => mock(() => {}) as unknown as NextFunction;

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

describe("SessionMiddleware bearer cache isolation", () => {
  it("does not let a session cookie read a cached API-key entry", async () => {
    const { mw, getSession } = build();
    await mw.use(req({ authorization: "Bearer atr_abc" }), {} as Response, noop());

    // An attacker who learns the stored keyHash replays it as a session cookie.
    const r = req({}, { "better-auth.session_token": hashApiKey("atr_abc") }) as Request &
      Record<string, any>;
    await mw.use(r, {} as Response, noop());

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(r.user).toBeUndefined();
    expect(r.apiKeyId).toBeUndefined();
  });

  it("does not let a bearer key read a cached cookie session", async () => {
    const { mw, apiKeys } = build(null);
    // A cookie session cached under a token that happens to equal the key hash.
    const cookieCache = (mw as unknown as { cache: Map<string, unknown> }).cache;
    cookieCache.set(hashApiKey("atr_abc"), {
      user: resolved.user,
      session: { id: "s1" },
      expiresAt: Date.now() + 30_000,
    });

    const r = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    await mw.use(r, {} as Response, noop());

    expect(apiKeys.resolve).toHaveBeenCalledTimes(1);
    expect(r.user).toBeUndefined();
  });

  it("leaves the request unauthenticated and calls next once when resolve rejects", async () => {
    const mw = new SessionMiddleware(
      { auth: { api: { getSession: mock(() => Promise.resolve(null)) } } } as never,
      { resolve: mock(() => Promise.reject(new Error("db down"))) } as never,
    );
    const r = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(r, {} as Response, next);

    expect(r.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("re-resolves a key once its cached entry has expired", async () => {
    const { mw, apiKeys } = build();
    await mw.use(req({ authorization: "Bearer atr_abc" }), {} as Response, noop());

    const cache = (mw as unknown as { bearerCache: Map<string, { expiresAt: number }> }).bearerCache;
    const entry = cache.get(hashApiKey("atr_abc"));
    expect(entry).toBeDefined();
    entry!.expiresAt = Date.now() - 1;

    const r = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    await mw.use(r, {} as Response, noop());

    expect(apiKeys.resolve).toHaveBeenCalledTimes(2);
    expect(r.user.id).toBe("u1");
  });
});
