import { describe, expect, it } from "bun:test";
import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SecondFactorGuard } from "./second-factor.guard";

interface FakeRequest {
  originalUrl: string;
  user?: { id: string; twoFactorEnabled?: boolean };
  session?: { secondFactor?: string | null };
  member?: { role: string };
  bearerKind?: string;
  previewMode?: boolean;
  workspaceRequiresTwoFactor?: boolean;
  staffInRequiringWorkspace?: boolean;
  sessionLookupFailed?: boolean;
}

function context(request: FakeRequest, isPublic = false): ExecutionContext {
  const handler = (): void => undefined;
  if (isPublic) Reflect.defineMetadata("isPublic", true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const guard = new SecondFactorGuard(new Reflector());
const pendingUser = { id: "u1", twoFactorEnabled: true };

function refusalCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return ((err as ForbiddenException).getResponse() as { code?: string }).code;
  }
  return undefined;
}

describe("SecondFactorGuard", () => {
  it("refuses a pending session on a guarded route", () => {
    const req: FakeRequest = { originalUrl: "/api/projects?x=1", user: pendingUser, session: { secondFactor: null } };
    expect(refusalCode(() => guard.canActivate(context(req)))).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("refuses a pending session on the Better Auth proxy, which is public", () => {
    const req: FakeRequest = {
      originalUrl: "/api/auth/organization/invite-member",
      user: pendingUser,
      session: { secondFactor: null },
    };
    expect(refusalCode(() => guard.canActivate(context(req, true)))).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("canonicalizes the auth path before matching", () => {
    const req: FakeRequest = {
      originalUrl: "/API//Auth/two-factor/DISABLE/",
      user: pendingUser,
      session: { secondFactor: null },
    };
    expect(refusalCode(() => guard.canActivate(context(req, true)))).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("lets a pending session step up through the proxy", () => {
    const req: FakeRequest = {
      originalUrl: "/api/auth/two-factor/verify-totp",
      user: pendingUser,
      session: { secondFactor: null },
    };
    expect(guard.canActivate(context(req, true))).toBe(true);
  });

  it("lets a pending session use other public routes", () => {
    const req: FakeRequest = { originalUrl: "/api/branding/public", user: pendingUser, session: { secondFactor: null } };
    expect(guard.canActivate(context(req, true))).toBe(true);
  });

  it("lets bearer requests through", () => {
    const req: FakeRequest = {
      originalUrl: "/api/projects",
      user: pendingUser,
      session: { secondFactor: null },
      bearerKind: "apiKey",
    };
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it("lets anonymous requests through for AuthGuard to handle", () => {
    expect(guard.canActivate(context({ originalUrl: "/api/projects" }))).toBe(true);
  });

  it("refuses staff without a factor in a requiring workspace", () => {
    const req: FakeRequest = {
      originalUrl: "/api/projects",
      user: { id: "u1" },
      session: { secondFactor: null },
      member: { role: "admin" },
      workspaceRequiresTwoFactor: true,
    };
    expect(refusalCode(() => guard.canActivate(context(req)))).toBe("TWO_FACTOR_REQUIRED");
  });

  it("treats an owner previewing as a client as staff", () => {
    const req: FakeRequest = {
      originalUrl: "/api/projects",
      user: { id: "u1" },
      session: { secondFactor: null },
      member: { role: "member" },
      previewMode: true,
      workspaceRequiresTwoFactor: true,
    };
    expect(refusalCode(() => guard.canActivate(context(req)))).toBe("TWO_FACTOR_REQUIRED");
  });

  it("never forces a client", () => {
    const req: FakeRequest = {
      originalUrl: "/api/projects",
      user: { id: "u1" },
      session: { secondFactor: null },
      member: { role: "member" },
      workspaceRequiresTwoFactor: true,
    };
    expect(guard.canActivate(context(req))).toBe(true);
  });
  it("holds staff who owe setup anywhere to it on organization routes naming another workspace", () => {
    // No active workspace (set-active null), so the active-workspace rule sees nothing.
    const req: FakeRequest = {
      originalUrl: "/api/auth/organization/invite-member",
      user: { id: "u1" },
      session: { secondFactor: null },
      staffInRequiringWorkspace: true,
    };
    expect(refusalCode(() => guard.canActivate(context(req, true)))).toBe("TWO_FACTOR_REQUIRED");
  });

  it("still lets them list and switch workspaces", () => {
    for (const url of ["/api/auth/organization/list", "/api/auth/organization/set-active"]) {
      const req: FakeRequest = { originalUrl: url, user: { id: "u1" }, session: { secondFactor: null }, staffInRequiringWorkspace: true };
      expect(guard.canActivate(context(req, true))).toBe(true);
    }
  });

  it("does not hold them on Atrium routes of a workspace that doesn't require it", () => {
    const req: FakeRequest = {
      originalUrl: "/api/projects",
      user: { id: "u1" },
      session: { secondFactor: null },
      member: { role: "member" },
      staffInRequiringWorkspace: true,
    };
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it("refuses the auth proxy when the session could not be resolved", () => {
    const req: FakeRequest = { originalUrl: "/api/auth/organization/invite-member", sessionLookupFailed: true };
    expect(() => guard.canActivate(context(req, true))).toThrow(ServiceUnavailableException);
  });

  it("still lets an unresolved session sign out", () => {
    const req: FakeRequest = { originalUrl: "/api/auth/sign-out", sessionLookupFailed: true };
    expect(guard.canActivate(context(req, true))).toBe(true);
  });
});
