import { describe, expect, it } from "bun:test";
import { CsrfGuard } from "./csrf.guard";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

/** A session cookie that triggers CSRF enforcement in the guard. */
const SESSION_COOKIES = {
  "better-auth.session_token": "test-session-value",
};

function createMockContext(
  method: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
  url = "/api/projects",
): { context: ExecutionContext; response: { cookie: () => void } } {
  const response = {
    cookie: () => {},
  };
  const request = {
    method,
    cookies,
    headers,
    originalUrl: url,
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  return { context, response };
}

describe("CsrfGuard", () => {
  // --- Safe methods ---

  it("allows GET requests without CSRF token", () => {
    const reflector = new Reflector();
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("GET");

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows HEAD requests without CSRF token", () => {
    const reflector = new Reflector();
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("HEAD");

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows OPTIONS requests without CSRF token", () => {
    const reflector = new Reflector();
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("OPTIONS");

    expect(guard.canActivate(context)).toBe(true);
  });

  // --- Route-based skips ---

  it("allows auth proxy routes without CSRF token", () => {
    const reflector = new Reflector();
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("POST", {}, {}, "/api/auth/sign-in/email");

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows public endpoints without CSRF token", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => true;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("POST");

    expect(guard.canActivate(context)).toBe(true);
  });

  // --- Session-based skip (no session = no CSRF risk) ---

  it("skips CSRF validation for POST when no session cookie exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    // No session cookie, no CSRF header -- should still pass
    const { context } = createMockContext("POST", {}, {});

    expect(guard.canActivate(context)).toBe(true);
  });

  it("skips CSRF for PUT when no session cookie exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("PUT");

    expect(guard.canActivate(context)).toBe(true);
  });

  it("skips CSRF for DELETE when no session cookie exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("DELETE");

    expect(guard.canActivate(context)).toBe(true);
  });

  it("skips CSRF for PATCH when no session cookie exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("PATCH");

    expect(guard.canActivate(context)).toBe(true);
  });

  // --- Valid CSRF (session + matching tokens) ---

  it("allows POST with session cookie when CSRF tokens match", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const token = "abc123def456";
    const { context } = createMockContext(
      "POST",
      { ...SESSION_COOKIES, "csrf-token": token },
      { "x-csrf-token": token },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  // --- Rejection cases (session exists but CSRF invalid) ---

  it("rejects POST when CSRF header is missing", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext(
      "POST",
      { ...SESSION_COOKIES, "csrf-token": "abc123" },
      {},
    );

    try {
      guard.canActivate(context);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it("rejects POST when CSRF cookie is missing (but session exists)", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext(
      "POST",
      { ...SESSION_COOKIES },
      { "x-csrf-token": "abc123" },
    );

    try {
      guard.canActivate(context);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it("rejects POST when cookie and header tokens do not match", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext(
      "POST",
      { ...SESSION_COOKIES, "csrf-token": "token-a" },
      { "x-csrf-token": "token-b" },
    );

    try {
      guard.canActivate(context);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it("rejects PUT without valid CSRF token when session exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("PUT", { ...SESSION_COOKIES });

    try {
      guard.canActivate(context);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it("rejects DELETE without valid CSRF token when session exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("DELETE", { ...SESSION_COOKIES });

    try {
      guard.canActivate(context);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it("rejects PATCH without valid CSRF token when session exists", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext("PATCH", { ...SESSION_COOKIES });

    try {
      guard.canActivate(context);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  // --- Cookie setting behavior ---

  it("sets csrf cookie when one does not exist", () => {
    const reflector = new Reflector();
    const guard = new CsrfGuard(reflector);
    let cookieSet = false;
    let cookieName = "";

    const response = {
      cookie: (name: string) => {
        cookieSet = true;
        cookieName = name;
      },
    };
    const request = {
      method: "GET",
      cookies: {},
      headers: {},
      originalUrl: "/api/projects",
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    guard.canActivate(context);

    expect(cookieSet).toBe(true);
    expect(cookieName).toBe("csrf-token");
  });

  it("does not overwrite csrf cookie when one already exists", () => {
    const reflector = new Reflector();
    const guard = new CsrfGuard(reflector);
    let cookieSet = false;

    const response = {
      cookie: () => {
        cookieSet = true;
      },
    };
    const request = {
      method: "GET",
      cookies: { "csrf-token": "existing-token" },
      headers: {},
      originalUrl: "/api/projects",
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    guard.canActivate(context);

    expect(cookieSet).toBe(false);
  });

  // --- Secure cookie variant ---

  it("skips CSRF for POST when __Secure- session cookie exists but no CSRF token", () => {
    const reflector = new Reflector();
    reflector.getAllAndOverride = () => false;
    const guard = new CsrfGuard(reflector);
    const { context } = createMockContext(
      "POST",
      { "__Secure-better-auth.session_token": "secure-session" },
      {},
    );

    try {
      guard.canActivate(context);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });
});
