import { describe, expect, it } from "bun:test";
import { AuthGuard } from "./auth.guard";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

function createMockContext(user: unknown, organization?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, organization }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getClass: () => ({}),
    getHandler: () => ({}),
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({} as unknown as ReturnType<ExecutionContext["switchToRpc"]>),
    switchToWs: () => ({} as unknown as ReturnType<ExecutionContext["switchToWs"]>),
    getType: () => "http" as const,
  } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  const reflector = new Reflector();
  const guard = new AuthGuard(reflector);

  it("allows authenticated requests with organization", async () => {
    const ctx = createMockContext(
      { id: "user-1", email: "test@test.com" },
      { id: "org-1" },
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("rejects unauthenticated requests", async () => {
    const ctx = createMockContext(null);
    try {
      await guard.canActivate(ctx);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
    }
  });

  it("rejects undefined user", async () => {
    const ctx = createMockContext(undefined, { id: "org-1" });
    try {
      await guard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
    }
  });

  it("rejects requests without organization context", async () => {
    const ctx = createMockContext({ id: "user-1", email: "test@test.com" }, undefined);
    try {
      await guard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
    }
  });
});
