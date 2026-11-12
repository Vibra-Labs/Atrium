import { describe, expect, it } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
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
});
