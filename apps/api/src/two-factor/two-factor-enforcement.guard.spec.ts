import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TwoFactorEnforcementGuard } from "./two-factor-enforcement.guard";
import type { PrismaService } from "../prisma/prisma.service";

type SettingsRow = { requireTwoFactor: boolean } | null;

function buildPrisma(settings: SettingsRow) {
  return {
    systemSettings: {
      findUnique: mock(() => Promise.resolve(settings)),
    },
  };
}

function buildContext(opts: {
  isPublic?: boolean;
  url?: string;
  user?: { id: string; twoFactorEnabled: boolean } | null;
  member?: { role: "owner" | "admin" | "member" } | null;
  organization?: { id: string } | null;
}): ExecutionContext {
  const handler = () => {};
  const reqClass = class {};
  const req = {
    originalUrl: opts.url ?? "/api/projects",
    user: opts.user ?? null,
    member: opts.member ?? null,
    organization: opts.organization ?? null,
  };
  return {
    getHandler: () => handler,
    getClass: () => reqClass,
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function buildReflector(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: mock(() => isPublic),
  } as unknown as Reflector;
}

describe("TwoFactorEnforcementGuard", () => {
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    prisma = buildPrisma({ requireTwoFactor: true });
  });

  it("passes through @Public() routes", async () => {
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(true),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({ isPublic: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("passes through /api/auth/two-factor/* enrollment routes", async () => {
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({
      url: "/api/auth/two-factor/enable",
      user: { id: "u1", twoFactorEnabled: false },
      member: { role: "admin" },
      organization: { id: "org-1" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("passes when no user is on the request (AuthGuard handles this)", async () => {
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({ user: null });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("passes for clients (member role) regardless of org policy", async () => {
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({
      user: { id: "client-1", twoFactorEnabled: false },
      member: { role: "member" },
      organization: { id: "org-1" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("passes for staff with 2FA enabled", async () => {
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({
      user: { id: "u1", twoFactorEnabled: true },
      member: { role: "owner" },
      organization: { id: "org-1" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("passes for staff without 2FA when org does not require it", async () => {
    prisma = buildPrisma({ requireTwoFactor: false });
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({
      user: { id: "u1", twoFactorEnabled: false },
      member: { role: "admin" },
      organization: { id: "org-1" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("throws 403 TWO_FACTOR_REQUIRED for staff without 2FA when org requires it", async () => {
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({
      user: { id: "u1", twoFactorEnabled: false },
      member: { role: "admin" },
      organization: { id: "org-1" },
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: "TWO_FACTOR_REQUIRED" }),
    });
  });

  it("treats missing settings row as requireTwoFactor=false", async () => {
    prisma = buildPrisma(null);
    const guard = new TwoFactorEnforcementGuard(
      buildReflector(false),
      prisma as unknown as PrismaService,
    );
    const ctx = buildContext({
      user: { id: "u1", twoFactorEnabled: false },
      member: { role: "admin" },
      organization: { id: "org-1" },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
