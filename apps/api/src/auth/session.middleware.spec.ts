import { describe, expect, it, mock } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { SessionMiddleware } from "./session.middleware";
import { hashApiKey } from "../api-keys/api-keys.service";
import { RateLimiter } from "../common";

const resolved = {
  apiKeyId: "k1",
  user: { id: "u1", name: "Ada", email: "a@t.co", emailVerified: true, image: null, createdAt: new Date(), updatedAt: new Date() },
  organization: { id: "org1", name: "Acme", slug: null, logo: null, createdAt: new Date(), updatedAt: new Date(), metadata: null },
  member: { id: "m1", userId: "u1", organizationId: "org1", role: "owner", createdAt: new Date() },
};

const oauthActor = { ...resolved, apiKeyId: undefined, oauthClientId: "c1" };

function config(oauthEnabled = "true") {
  return { get: (key: string, fallback?: string) => (key === "MCP_OAUTH_ENABLED" ? oauthEnabled : fallback) };
}

function build(resolveResult: unknown = resolved, oauthResult: unknown = null, oauthEnabled = "true") {
  const getSession = mock(() => Promise.resolve(null));
  const authService = { auth: { api: { getSession } } };
  const apiKeys = { resolve: mock(() => Promise.resolve(resolveResult)) };
  const mcpAuth = { resolve: mock(() => Promise.resolve(oauthResult)) };
  const mw = new SessionMiddleware(
    authService as never,
    apiKeys as never,
    mcpAuth as never,
    config(oauthEnabled) as never,
  );
  return { mw, getSession, apiKeys, mcpAuth };
}

function req(
  headers: Record<string, string>,
  cookies: Record<string, string> = {},
  ip = "10.0.0.1",
  originalUrl = "/api/projects",
): Request {
  return { headers, cookies, ip, originalUrl } as unknown as Request;
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

  it("resolves an OAuth token on /api/mcp", async () => {
    const { mw, mcpAuth, apiKeys } = build(resolved, oauthActor);
    const r = req({ authorization: "Bearer oauth-token" }, {}, "10.0.0.1", "/api/mcp") as Request &
      Record<string, any>;
    await mw.use(r, {} as Response, mock(() => {}) as unknown as NextFunction);
    expect(mcpAuth.resolve).toHaveBeenCalledWith("oauth-token");
    expect(apiKeys.resolve).not.toHaveBeenCalled();
    expect(r.user.id).toBe("u1");
    expect(r.session.activeOrganizationId).toBe("org1");
    expect(r.apiKeyId).toBeUndefined();
  });

  it("never resolves an OAuth token on any other route", async () => {
    const { mw, mcpAuth } = build(resolved, oauthActor);
    for (const url of ["/api/projects", "/api/api-keys", "/api/mcp-grants", "/api/mcp/extra", "/api/mcpx"]) {
      const r = req({ authorization: "Bearer oauth-token" }, {}, "10.0.0.1", url) as Request &
        Record<string, any>;
      await mw.use(r, {} as Response, mock(() => {}) as unknown as NextFunction);
      expect(r.user).toBeUndefined();
    }
    expect(mcpAuth.resolve).not.toHaveBeenCalled();
  });

  it("treats /api/mcp with a query string as the MCP route", async () => {
    const { mw, mcpAuth } = build(resolved, oauthActor);
    await mw.use(
      req({ authorization: "Bearer oauth-token" }, {}, "10.0.0.1", "/api/mcp?x=1"),
      {} as Response,
      mock(() => {}) as unknown as NextFunction,
    );
    expect(mcpAuth.resolve).toHaveBeenCalledTimes(1);
  });

  it("ignores an OAuth token entirely when MCP_OAUTH_ENABLED is false", async () => {
    // The switch hides the connect UI and unmounts the plugin, but tokens
    // already issued live for up to an hour — so the middleware has to refuse
    // them too, otherwise turning OAuth off disconnects nobody.
    const { mw, mcpAuth } = build(resolved, oauthActor, "false");
    const r = req({ authorization: "Bearer oauth-token" }, {}, "10.0.0.1", "/api/mcp") as Request &
      Record<string, any>;
    await mw.use(r, {} as Response, mock(() => {}) as unknown as NextFunction);
    expect(mcpAuth.resolve).not.toHaveBeenCalled();
    expect(r.user).toBeUndefined();
  });

  it("marks bearer-derived identity with its kind, from the cache too", async () => {
    const { mw } = build();
    const first = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    await mw.use(first, {} as Response, noop());
    expect(first.bearerKind).toBe("apiKey");

    const cached = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    await mw.use(cached, {} as Response, noop());
    expect(cached.bearerKind).toBe("apiKey");

    const { mw: oauthMw } = build(resolved, oauthActor);
    const oauth = req({ authorization: "Bearer oauth-token" }, {}, "10.0.0.1", "/api/mcp") as Request &
      Record<string, any>;
    await oauthMw.use(oauth, {} as Response, noop());
    expect(oauth.bearerKind).toBe("oauth");
  });

  it("leaves bearerKind unset for a cookie session", async () => {
    const { mw } = build();
    const r = req({}, { "better-auth.session_token": "s1" }) as Request & Record<string, any>;
    await mw.use(r, {} as Response, noop());
    expect(r.bearerKind).toBeUndefined();
  });

  it("still prefers a session cookie over an OAuth token on /api/mcp", async () => {
    const { mw, mcpAuth, getSession } = build(resolved, oauthActor);
    const r = req(
      { authorization: "Bearer oauth-token" },
      { "better-auth.session_token": "s1" },
      "10.0.0.1",
      "/api/mcp",
    );
    await mw.use(r, {} as Response, mock(() => {}) as unknown as NextFunction);
    expect(mcpAuth.resolve).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
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
      { resolve: mock(() => Promise.resolve(null)) } as never,
      config() as never,
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
    const entry = cache.get(`apiKey:${hashApiKey("atr_abc")}`);
    expect(entry).toBeDefined();
    entry!.expiresAt = Date.now() - 1;

    const r = req({ authorization: "Bearer atr_abc" }) as Request & Record<string, any>;
    await mw.use(r, {} as Response, noop());

    expect(apiKeys.resolve).toHaveBeenCalledTimes(2);
    expect(r.user.id).toBe("u1");
  });
});

describe("SessionMiddleware failed-key limiter", () => {
  async function fail(mw: SessionMiddleware, ip: string): Promise<Request & Record<string, any>> {
    const r = req({ authorization: "Bearer atr_bad" }, {}, ip) as Request & Record<string, any>;
    await mw.use(r, {} as Response, noop());
    return r;
  }

  it("stops looking keys up after 30 failures from one IP", async () => {
    const { mw, apiKeys } = build(null);
    for (let i = 0; i < 30; i++) {
      const r = await fail(mw, "1.2.3.4");
      expect(r.authRateLimited).toBeUndefined();
    }
    expect(apiKeys.resolve).toHaveBeenCalledTimes(30);

    const blocked = await fail(mw, "1.2.3.4");
    expect(apiKeys.resolve).toHaveBeenCalledTimes(30);
    expect(blocked.authRateLimited).toBe(true);
    expect(blocked.user).toBeUndefined();
  });

  it("keeps resolving keys from other IPs", async () => {
    const { mw, apiKeys } = build(null);
    for (let i = 0; i < 31; i++) await fail(mw, "1.2.3.4");
    const other = await fail(mw, "5.6.7.8");
    expect(other.authRateLimited).toBeUndefined();
    expect(apiKeys.resolve).toHaveBeenCalledTimes(31);
  });

  it("still serves a cached valid key from a limited IP", async () => {
    const { mw, apiKeys } = build();
    // Warm the cache with a good key, then exhaust the IP with bad ones.
    await mw.use(req({ authorization: "Bearer atr_abc" }, {}, "1.2.3.4"), {} as Response, noop());
    (apiKeys.resolve as unknown as { mockImplementation: (f: () => Promise<null>) => void })
      .mockImplementation(() => Promise.resolve(null));
    for (let i = 0; i < 31; i++) await fail(mw, "1.2.3.4");

    const r = req({ authorization: "Bearer atr_abc" }, {}, "1.2.3.4") as Request & Record<string, any>;
    await mw.use(r, {} as Response, noop());
    expect(r.user.id).toBe("u1");
    expect(r.authRateLimited).toBeUndefined();
  });

  it("stops looking OAuth tokens up after 30 failures from one IP", async () => {
    const { mw, mcpAuth } = build(resolved, null);
    for (let i = 0; i < 30; i++) {
      const r = req({ authorization: "Bearer oauth-bad" }, {}, "1.2.3.4", "/api/mcp") as Request &
        Record<string, any>;
      await mw.use(r, {} as Response, noop());
      expect(r.authRateLimited).toBeUndefined();
    }
    expect(mcpAuth.resolve).toHaveBeenCalledTimes(30);

    const blocked = req({ authorization: "Bearer oauth-bad" }, {}, "1.2.3.4", "/api/mcp") as Request &
      Record<string, any>;
    await mw.use(blocked, {} as Response, noop());
    expect(mcpAuth.resolve).toHaveBeenCalledTimes(30);
    expect(blocked.authRateLimited).toBe(true);
    expect(blocked.user).toBeUndefined();
  });

  it("does not count successful resolutions against the IP", async () => {
    const { mw, apiKeys } = build();
    for (let i = 0; i < 40; i++) {
      const r = req({ authorization: `Bearer atr_${i}` }, {}, "1.2.3.4") as Request & Record<string, any>;
      await mw.use(r, {} as Response, noop());
      expect(r.user.id).toBe("u1");
    }
    expect(apiKeys.resolve).toHaveBeenCalledTimes(40);
  });
});

describe("SessionMiddleware failed-key limiter at capacity", () => {
  /** The limiter is a gate in front of auth, so a full map must not block valid keys. */
  function fillLimiter(mw: SessionMiddleware): void {
    const holder = mw as unknown as { failedBearer: RateLimiter };
    holder.failedBearer = new RateLimiter(30, 60_000, 1, false);
    holder.failedBearer.allow("9.9.9.9");
  }

  it("still authenticates a valid key from a never-seen IP", async () => {
    const { mw, apiKeys } = build();
    fillLimiter(mw);

    const r = req({ authorization: "Bearer atr_abc" }, {}, "1.2.3.4") as Request &
      Record<string, any>;
    const next = mock(() => {}) as unknown as NextFunction;
    await mw.use(r, {} as Response, next);

    expect(apiKeys.resolve).toHaveBeenCalledTimes(1);
    expect(r.user.id).toBe("u1");
    expect(r.authRateLimited).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("records a failure when resolve rejects", async () => {
    const resolve = mock(() => Promise.reject(new Error("db down")));
    const mw = new SessionMiddleware(
      { auth: { api: { getSession: mock(() => Promise.resolve(null)) } } } as never,
      { resolve } as never,
      { resolve: mock(() => Promise.resolve(null)) } as never,
      config() as never,
    );
    // 30 expected rejections would otherwise fill the test output with warnings.
    (mw as unknown as { logger: { warn: () => void } }).logger = { warn: mock(() => {}) };

    for (let i = 0; i < 30; i++) {
      const r = req({ authorization: "Bearer atr_bad" }, {}, "1.2.3.4") as Request &
        Record<string, any>;
      const next = mock(() => {}) as unknown as NextFunction;
      await mw.use(r, {} as Response, next);
      expect(r.authRateLimited).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    }
    expect(resolve).toHaveBeenCalledTimes(30);

    const blocked = req({ authorization: "Bearer atr_bad" }, {}, "1.2.3.4") as Request &
      Record<string, any>;
    const next = mock(() => {}) as unknown as NextFunction;
    await mw.use(blocked, {} as Response, next);

    expect(resolve).toHaveBeenCalledTimes(30);
    expect(blocked.authRateLimited).toBe(true);
    expect(blocked.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
