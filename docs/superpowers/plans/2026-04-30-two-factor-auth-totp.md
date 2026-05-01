# Two-Factor Authentication (TOTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TOTP-based two-factor authentication with recovery codes, 30-day trusted-device cookie, and an org-level "Require 2FA for staff" toggle. Owner/admin can disable 2FA for locked-out users; a CLI script handles owner lockouts.

**Architecture:** Better Auth's `twoFactor` plugin handles cryptography, code verification, backup codes, and the trust-device cookie. Atrium owns: a `requireTwoFactor` field on `SystemSettings`, a NestJS `TwoFactorEnforcementGuard`, a small admin-only endpoint to disable 2FA for another user, a `/two-factor/status` endpoint for the UI, a CLI script for owner-lockout recovery, and the web UI surfaces (settings page, login challenge page, forced-enrollment redirect, team-members "Disable 2FA" action).

**Tech Stack:** NestJS 11, Better Auth `twoFactor` plugin (already in `better-auth` v1.2+), Prisma, Bun test runner, Next.js 15 + React 19, `qrcode` (npm) for QR rendering, `otplib` (devDependency) for generating TOTP codes in tests, Playwright for e2e.

---

## File Structure

**Created:**
- `apps/api/src/two-factor/two-factor.module.ts`
- `apps/api/src/two-factor/two-factor.controller.ts`
- `apps/api/src/two-factor/two-factor.controller.spec.ts`
- `apps/api/src/two-factor/two-factor.service.ts`
- `apps/api/src/two-factor/two-factor.service.spec.ts`
- `apps/api/src/two-factor/two-factor-enforcement.guard.ts`
- `apps/api/src/two-factor/two-factor-enforcement.guard.spec.ts`
- `apps/api/src/scripts/disable-2fa.ts`
- `apps/web/src/app/(auth)/login/2fa/page.tsx`
- `apps/web/src/app/(auth)/login/2fa/two-factor-form.tsx`
- `apps/web/src/app/(auth)/2fa/setup/page.tsx`
- `apps/web/src/app/(dashboard)/dashboard/settings/security/page.tsx`
- `apps/web/src/app/(dashboard)/dashboard/settings/security/security-section.tsx`
- `apps/web/src/components/two-factor-setup.tsx`
- `apps/web/src/components/backup-codes-display.tsx`
- `e2e/tests/two-factor.e2e.ts`

**Modified:**
- `packages/database/prisma/schema.prisma` (add `requireTwoFactor` to `SystemSettings`)
- `apps/api/package.json` (add `script:disable-2fa` script)
- `apps/api/src/auth/auth.service.ts` (register Better Auth `twoFactor` plugin)
- `apps/api/src/app.module.ts` (register `TwoFactorModule` and `TwoFactorEnforcementGuard` globally)
- `apps/api/src/common/index.ts` (export `TWO_FACTOR_REQUIRED` error code constant)
- `apps/web/package.json` (add `qrcode` dependency)
- `apps/web/src/lib/api.ts` (intercept `TWO_FACTOR_REQUIRED` and redirect)
- `apps/web/src/app/(auth)/login/login-form.tsx` (handle `twoFactorRedirect` from Better Auth)
- `apps/web/src/app/(dashboard)/dashboard/settings/page.tsx` (add Security tab/link)
- `apps/web/src/app/(dashboard)/dashboard/clients/team-section.tsx` (add Disable 2FA admin action)
- `e2e/global-setup.ts` (no change required — E2E user has no 2FA)
- `README.md` (add "Recovery — disabling 2FA for a locked-out owner" section)

---

## Conventions used throughout

- **Bun test runner**: `import { describe, expect, it, mock, beforeEach } from "bun:test";`
- **Mock Prisma pattern**: a literal object whose methods are `mock(() => Promise.resolve(...))`; clear via a helper that walks the object.
- **Type aliases**: `mockPrisma as unknown as PrismaService` when injecting.
- **Commit style**: conventional commits (`feat(api)`, `feat(web)`, `feat(db)`, `test(api)`, `chore(deps)`, `docs`).
- **Branch**: all work lands on `feat/two-factor-auth` (already created from `main`). PR opened only when explicitly requested by the user.

---

## Task 1: Add `requireTwoFactor` field to SystemSettings

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add the column**

In `packages/database/prisma/schema.prisma`, locate `model SystemSettings` and add the field next to `setupCompleted`:

```prisma
  // Security
  requireTwoFactor Boolean @default(false)

  // General
  setupCompleted Boolean  @default(false)
```

- [ ] **Step 2: Push the schema and regenerate the client**

Run from repo root:
```bash
bun run db:push
bun run db:generate
```
Expected: schema applied, Prisma client regenerated, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(db): add requireTwoFactor flag to SystemSettings"
```

---

## Task 2: Add `qrcode` to web and `otplib` to e2e

**Files:**
- Modify: `apps/web/package.json`
- Modify: `e2e/package.json` (or root `package.json` if e2e shares root deps — check first)

- [ ] **Step 1: Find where e2e devDependencies live**

Run: `cat e2e/package.json 2>/dev/null || echo "no e2e package.json"`
If `e2e/package.json` does not exist, e2e shares the root workspace and `otplib` should be added to the root `package.json` `devDependencies`.

- [ ] **Step 2: Install qrcode in apps/web**

Run from repo root:
```bash
bun add --filter=@atrium/web qrcode
bun add --filter=@atrium/web -d @types/qrcode
```
Expected: `qrcode` added to `apps/web/package.json` dependencies and `@types/qrcode` added to devDependencies.

- [ ] **Step 3: Install otplib for e2e tests**

If `e2e/package.json` exists:
```bash
bun add --cwd=e2e -d otplib
```
Otherwise add to repo root:
```bash
bun add -d otplib
```
Expected: `otplib` available for `import { authenticator } from "otplib"` in test files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json package.json e2e/package.json bun.lock 2>/dev/null
git commit -m "chore(deps): add qrcode (web) and otplib (e2e) for TOTP support"
```

---

## Task 3: Wire the Better Auth `twoFactor` plugin into AuthService

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`

- [ ] **Step 1: Add the import**

In `apps/api/src/auth/auth.service.ts`, update the existing `better-auth/plugins` import:

```ts
import { organization, magicLink, twoFactor } from "better-auth/plugins";
```

- [ ] **Step 2: Register the plugin**

In the `betterAuth({ ... })` config inside the `AuthService` constructor, add `twoFactor` to the existing `plugins` array. Place it after `magicLink`:

```ts
plugins: [
  organization({
    /* existing config */
  }),
  magicLink({
    /* existing config */
  }),
  twoFactor({
    issuer: "Atrium",
    totpOptions: {
      digits: 6,
      period: 30,
    },
    backupCodeOptions: {
      amount: 10,
      length: 10,
    },
  }),
],
```

The `issuer: "Atrium"` controls the label that appears next to the user's email in their authenticator app.

- [ ] **Step 3: Push schema (Better Auth's adapter declares the new tables)**

Run from repo root:
```bash
bun run db:push
bun run db:generate
```
Expected: A new `twoFactor` table is created and `User.twoFactorEnabled` (Boolean, default false) is added. Prisma client regenerated.

- [ ] **Step 4: Verify tables**

Run:
```bash
bun --cwd packages/database x prisma db pull --print | grep -A 5 "twoFactor"
```
Expected: shows the new `twoFactor` table with `userId`, `secret`, `backupCodes`. Confirms Better Auth's adapter applied the migration.

- [ ] **Step 5: Smoke test the API still starts**

Run:
```bash
bun run dev
```
Expected: API starts on :3001 without errors. Stop it with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.service.ts
git commit -m "feat(auth): register Better Auth twoFactor plugin"
```

---

## Task 4: TwoFactorEnforcementGuard — failing test

**Files:**
- Create: `apps/api/src/two-factor/two-factor-enforcement.guard.spec.ts`

- [ ] **Step 1: Create the spec file**

```ts
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
```

- [ ] **Step 2: Run the test (it should fail because the guard doesn't exist yet)**

Run: `cd apps/api && bun test src/two-factor/two-factor-enforcement.guard.spec.ts`
Expected: FAIL — module `./two-factor-enforcement.guard` not found.

---

## Task 5: TwoFactorEnforcementGuard — implementation

**Files:**
- Create: `apps/api/src/two-factor/two-factor-enforcement.guard.ts`

- [ ] **Step 1: Implement the guard**

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

const TWO_FACTOR_AUTH_PATH_PREFIX = "/api/auth/two-factor/";
const STAFF_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class TwoFactorEnforcementGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const url: string = request.originalUrl ?? "";

    // Allow Better Auth's two-factor endpoints so users can enroll while
    // being forced to enroll.
    if (url.startsWith(TWO_FACTOR_AUTH_PATH_PREFIX)) return true;

    // No user yet — AuthGuard will reject. Don't double up.
    if (!request.user || !request.member || !request.organization) return true;

    // Clients are never forced.
    if (!STAFF_ROLES.has(request.member.role)) return true;

    // Already enrolled.
    if (request.user.twoFactorEnabled === true) return true;

    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: request.organization.id },
      select: { requireTwoFactor: true },
    });

    if (!settings?.requireTwoFactor) return true;

    throw new ForbiddenException({
      code: "TWO_FACTOR_REQUIRED",
      message: "Your organization requires two-factor authentication. Please enroll to continue.",
    });
  }
}
```

- [ ] **Step 2: Run the test**

Run: `cd apps/api && bun test src/two-factor/two-factor-enforcement.guard.spec.ts`
Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/two-factor/two-factor-enforcement.guard.ts apps/api/src/two-factor/two-factor-enforcement.guard.spec.ts
git commit -m "feat(api): TwoFactorEnforcementGuard with org-level enforcement"
```

---

## Task 6: TwoFactorService — failing tests

**Files:**
- Create: `apps/api/src/two-factor/two-factor.service.spec.ts`

The service owns: `getStatus(userId, orgId)`, `disableForUser(actorUserId, targetUserId, organizationId)`.

- [ ] **Step 1: Create the spec file**

```ts
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { TwoFactorService } from "./two-factor.service";

const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
};

const mockPrisma = {
  user: {
    findUnique: mock(() => Promise.resolve(null) as Promise<unknown>),
    update: mock(() => Promise.resolve({}) as Promise<unknown>),
  },
  member: {
    findFirst: mock(() => Promise.resolve(null) as Promise<unknown>),
  },
  systemSettings: {
    findUnique: mock(() => Promise.resolve(null) as Promise<unknown>),
  },
  twoFactor: {
    findFirst: mock(() => Promise.resolve(null) as Promise<unknown>),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
};

function clearMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof mock>).mockClear();
    }
  }
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
}

function buildService() {
  return new TwoFactorService(
    mockPrisma as unknown as PrismaService,
    mockLogger as unknown as Parameters<typeof TwoFactorService>[1],
  );
}

describe("TwoFactorService", () => {
  beforeEach(clearMocks);

  describe("getStatus", () => {
    it("returns enabled=false, requiredByOrg=false when nothing configured", async () => {
      mockPrisma.user.findUnique = mock(() =>
        Promise.resolve({ twoFactorEnabled: false }),
      );
      mockPrisma.systemSettings.findUnique = mock(() => Promise.resolve(null));

      const result = await buildService().getStatus("u1", "org-1");

      expect(result).toEqual({
        enabled: false,
        requiredByOrg: false,
      });
    });

    it("returns enabled=true when the user has 2FA on", async () => {
      mockPrisma.user.findUnique = mock(() =>
        Promise.resolve({ twoFactorEnabled: true }),
      );
      mockPrisma.systemSettings.findUnique = mock(() =>
        Promise.resolve({ requireTwoFactor: true }),
      );

      const result = await buildService().getStatus("u1", "org-1");

      expect(result).toEqual({
        enabled: true,
        requiredByOrg: true,
      });
    });

    it("treats missing user row as enabled=false", async () => {
      mockPrisma.user.findUnique = mock(() => Promise.resolve(null));

      const result = await buildService().getStatus("u-missing", "org-1");

      expect(result.enabled).toBe(false);
    });
  });

  describe("disableForUser", () => {
    it("rejects when actor and target are in different organizations", async () => {
      // actor is owner in org-1
      mockPrisma.member.findFirst = mock((args: unknown) => {
        const where = (args as { where: { userId: string; organizationId: string } }).where;
        if (where.userId === "actor" && where.organizationId === "org-1") {
          return Promise.resolve({ role: "owner" });
        }
        // target not in org-1
        return Promise.resolve(null);
      });

      await expect(
        buildService().disableForUser("actor", "target", "org-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects when actor is not owner/admin in the org", async () => {
      mockPrisma.member.findFirst = mock((args: unknown) => {
        const where = (args as { where: { userId: string; organizationId: string } }).where;
        if (where.userId === "actor") return Promise.resolve({ role: "member" });
        return Promise.resolve({ role: "member" });
      });

      await expect(
        buildService().disableForUser("actor", "target", "org-1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("clears the twoFactor row and User.twoFactorEnabled, then logs", async () => {
      mockPrisma.member.findFirst = mock((args: unknown) => {
        const where = (args as { where: { userId: string; organizationId: string } }).where;
        if (where.userId === "actor") return Promise.resolve({ role: "owner" });
        if (where.userId === "target") return Promise.resolve({ role: "admin" });
        return Promise.resolve(null);
      });
      mockPrisma.twoFactor.deleteMany = mock(() => Promise.resolve({ count: 1 }));
      mockPrisma.user.update = mock(() =>
        Promise.resolve({ id: "target", twoFactorEnabled: false }),
      );

      await buildService().disableForUser("actor", "target", "org-1");

      expect(mockPrisma.twoFactor.deleteMany).toHaveBeenCalledWith({
        where: { userId: "target" },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "target" },
        data: { twoFactorEnabled: false },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "two_factor.admin_disabled",
          actorId: "actor",
          targetUserId: "target",
          organizationId: "org-1",
        }),
        expect.any(String),
      );
    });

    it("rejects when actor tries to disable their own 2FA via this endpoint", async () => {
      // Self-disable goes through Better Auth's POST /two-factor/disable — this
      // admin endpoint is for disabling others, not yourself.
      mockPrisma.member.findFirst = mock(() =>
        Promise.resolve({ role: "owner" }),
      );

      await expect(
        buildService().disableForUser("actor", "actor", "org-1"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/api && bun test src/two-factor/two-factor.service.spec.ts`
Expected: FAIL — module `./two-factor.service` not found.

---

## Task 7: TwoFactorService — implementation

**Files:**
- Create: `apps/api/src/two-factor/two-factor.service.ts`

- [ ] **Step 1: Implement the service**

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";

const STAFF_ROLES = new Set(["owner", "admin"]);

export interface TwoFactorStatus {
  enabled: boolean;
  requiredByOrg: boolean;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(TwoFactorService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getStatus(userId: string, organizationId: string): Promise<TwoFactorStatus> {
    const [user, settings] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      }),
      this.prisma.systemSettings.findUnique({
        where: { organizationId },
        select: { requireTwoFactor: true },
      }),
    ]);

    return {
      enabled: user?.twoFactorEnabled ?? false,
      requiredByOrg: settings?.requireTwoFactor ?? false,
    };
  }

  async disableForUser(
    actorUserId: string,
    targetUserId: string,
    organizationId: string,
  ): Promise<{ success: true }> {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException(
        "Use the self-service disable flow for your own account.",
      );
    }

    const [actorMember, targetMember] = await Promise.all([
      this.prisma.member.findFirst({
        where: { userId: actorUserId, organizationId },
        select: { role: true },
      }),
      this.prisma.member.findFirst({
        where: { userId: targetUserId, organizationId },
        select: { role: true },
      }),
    ]);

    if (!targetMember) {
      throw new NotFoundException("Target user is not a member of this organization");
    }
    if (!actorMember || !STAFF_ROLES.has(actorMember.role)) {
      throw new ForbiddenException("Only owners and admins can disable 2FA for other users");
    }

    await this.prisma.twoFactor.deleteMany({ where: { userId: targetUserId } });
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { twoFactorEnabled: false },
    });

    this.logger.info(
      {
        event: "two_factor.admin_disabled",
        actorId: actorUserId,
        targetUserId,
        organizationId,
      },
      "Admin disabled 2FA for another user",
    );

    return { success: true };
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/api && bun test src/two-factor/two-factor.service.spec.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/two-factor/two-factor.service.ts apps/api/src/two-factor/two-factor.service.spec.ts
git commit -m "feat(api): TwoFactorService — status query and admin-disable"
```

---

## Task 8: TwoFactorController — failing test

**Files:**
- Create: `apps/api/src/two-factor/two-factor.controller.spec.ts`

- [ ] **Step 1: Create the spec**

```ts
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { TwoFactorController } from "./two-factor.controller";
import type { TwoFactorService } from "./two-factor.service";

const mockService = {
  getStatus: mock(() => Promise.resolve({ enabled: false, requiredByOrg: false })),
  disableForUser: mock(() => Promise.resolve({ success: true })),
};

function clearMocks() {
  mockService.getStatus.mockClear();
  mockService.disableForUser.mockClear();
}

function buildController() {
  return new TwoFactorController(mockService as unknown as TwoFactorService);
}

describe("TwoFactorController", () => {
  beforeEach(clearMocks);

  describe("GET /two-factor/status", () => {
    it("delegates to service.getStatus with current user and org", async () => {
      mockService.getStatus = mock(() =>
        Promise.resolve({ enabled: true, requiredByOrg: true }),
      );

      const result = await buildController().status("user-1", "org-1");

      expect(mockService.getStatus).toHaveBeenCalledWith("user-1", "org-1");
      expect(result).toEqual({ enabled: true, requiredByOrg: true });
    });
  });

  describe("DELETE /two-factor/admin/:userId", () => {
    it("delegates to service.disableForUser", async () => {
      const result = await buildController().disableForUser(
        "target-1",
        "actor-1",
        "org-1",
      );

      expect(mockService.disableForUser).toHaveBeenCalledWith(
        "actor-1",
        "target-1",
        "org-1",
      );
      expect(result).toEqual({ success: true });
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd apps/api && bun test src/two-factor/two-factor.controller.spec.ts`
Expected: FAIL — module not found.

---

## Task 9: TwoFactorController — implementation

**Files:**
- Create: `apps/api/src/two-factor/two-factor.controller.ts`

- [ ] **Step 1: Implement**

```ts
import {
  Controller,
  Delete,
  Get,
  Param,
  UseGuards,
} from "@nestjs/common";
import {
  AuthGuard,
  CurrentOrg,
  CurrentUser,
  Roles,
  RolesGuard,
} from "../common";
import { TwoFactorService } from "./two-factor.service";

@Controller("two-factor")
@UseGuards(AuthGuard, RolesGuard)
export class TwoFactorController {
  constructor(private service: TwoFactorService) {}

  @Get("status")
  status(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") organizationId: string,
  ) {
    return this.service.getStatus(userId, organizationId);
  }

  @Delete("admin/:userId")
  @Roles("owner", "admin")
  disableForUser(
    @Param("userId") targetUserId: string,
    @CurrentUser("id") actorUserId: string,
    @CurrentOrg("id") organizationId: string,
  ) {
    return this.service.disableForUser(actorUserId, targetUserId, organizationId);
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/api && bun test src/two-factor/two-factor.controller.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/two-factor/two-factor.controller.ts apps/api/src/two-factor/two-factor.controller.spec.ts
git commit -m "feat(api): TwoFactorController — status and admin-disable endpoints"
```

---

## Task 10: TwoFactorModule + register globally

**Files:**
- Create: `apps/api/src/two-factor/two-factor.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create the module**

```ts
import { Module } from "@nestjs/common";
import { TwoFactorController } from "./two-factor.controller";
import { TwoFactorService } from "./two-factor.service";
import { TwoFactorEnforcementGuard } from "./two-factor-enforcement.guard";

@Module({
  controllers: [TwoFactorController],
  providers: [TwoFactorService, TwoFactorEnforcementGuard],
  exports: [TwoFactorService, TwoFactorEnforcementGuard],
})
export class TwoFactorModule {}
```

- [ ] **Step 2: Register the module and the global guard**

In `apps/api/src/app.module.ts`:

a) Add the import alongside the other module imports:
```ts
import { TwoFactorModule } from "./two-factor/two-factor.module";
import { TwoFactorEnforcementGuard } from "./two-factor/two-factor-enforcement.guard";
```

b) Add `TwoFactorModule` to the `imports` array (place after `EmbedsModule`).

c) Add the guard to the global `providers` array, after `PreviewModeGuard`:
```ts
{
  provide: APP_GUARD,
  useClass: TwoFactorEnforcementGuard,
},
```

The order matters: `TwoFactorEnforcementGuard` runs after `AuthGuard` because NestJS runs `APP_GUARD` providers in declaration order, and `AuthGuard` is applied per-controller via `@UseGuards`. Global guards run before per-controller guards, so this guard will see `request.user` populated by `SessionMiddleware` already.

- [ ] **Step 3: Confirm API still starts**

Run from repo root:
```bash
bun run dev
```
Expected: API starts on :3001, no errors. Stop with Ctrl+C.

- [ ] **Step 4: Run all API tests**

Run: `cd apps/api && bun test`
Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/two-factor/two-factor.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): wire TwoFactorModule and global enforcement guard"
```

---

## Task 11: CLI script — disable-2fa

**Files:**
- Create: `apps/api/src/scripts/disable-2fa.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Implement the script**

```ts
// Standalone CLI: disables 2FA for a user identified by email.
// Usage: bun run script:disable-2fa <email>

import { PrismaClient } from "@atrium/database";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: bun run script:disable-2fa <email>");
    process.exit(2);
  }

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, twoFactorEnabled: true },
    });

    if (!user) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }

    if (!user.twoFactorEnabled) {
      console.log(`User ${email} does not have 2FA enabled — nothing to do.`);
      process.exit(0);
    }

    await prisma.twoFactor.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false },
    });

    console.log(`✓ Disabled 2FA for ${email}`);
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Failed to disable 2FA:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script entry**

In `apps/api/package.json`, add to `scripts`:
```json
"script:disable-2fa": "bun run src/scripts/disable-2fa.ts"
```

- [ ] **Step 3: Smoke test (no real user)**

Run from `apps/api/`:
```bash
bun run script:disable-2fa nonexistent@test.local
```
Expected: prints `User not found: nonexistent@test.local`, exits with code 1.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/scripts/disable-2fa.ts apps/api/package.json
git commit -m "feat(api): CLI script to disable 2FA for a locked-out user"
```

---

## Task 12: README — Recovery section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the right section to add to**

Run: `grep -n "^##" README.md | head -20`
Pick a sensible insertion point (after Configuration / Environment, before Development).

- [ ] **Step 2: Add a Recovery section**

Add (replacing `<insertion-anchor>` with the section header you found):

```markdown
## Recovery

### Disabling 2FA for a locked-out user

If a user has lost access to their authenticator app **and** their recovery codes:

- **Owner or admin still has access:** sign in to the dashboard, open the team-members list, find the user, and click **Disable 2FA** in the row's menu.
- **The locked-out user is the only owner:** an operator with shell access to the API server can run:
  ```bash
  cd apps/api
  bun run script:disable-2fa <user-email>
  ```
  This works for both self-hosted instances and cloud deployments. After running, the user can sign in with their password and re-enroll.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document 2FA recovery procedures"
```

---

## Task 13: Web — TwoFactor setup component (opt-in flow)

**Files:**
- Create: `apps/web/src/components/two-factor-setup.tsx`
- Create: `apps/web/src/components/backup-codes-display.tsx`

This is a reusable component used by both the settings page and the forced-enrollment page.

- [ ] **Step 1: Implement BackupCodesDisplay**

```tsx
"use client";

import { useState } from "react";

interface Props {
  codes: string[];
  onAcknowledge: () => void;
}

export function BackupCodesDisplay({ codes, onAcknowledge }: Props) {
  const [copied, setCopied] = useState(false);

  const text = codes.join("\n");

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atrium-2fa-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-lg border bg-amber-50 p-4">
      <h3 className="font-semibold text-amber-900">Save your recovery codes</h3>
      <p className="mt-1 text-sm text-amber-800">
        These one-time codes let you sign in if you lose access to your authenticator app.
        They are shown only once.
      </p>
      <pre className="mt-3 rounded bg-white p-3 font-mono text-sm">
        {codes.map((c) => `${c}\n`).join("")}
      </pre>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded border px-3 py-1.5 text-sm hover:bg-white"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded border px-3 py-1.5 text-sm hover:bg-white"
        >
          Download .txt
        </button>
        <button
          type="button"
          onClick={onAcknowledge}
          className="ml-auto rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
        >
          I've saved these
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement TwoFactorSetup**

```tsx
"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { apiFetch } from "@/lib/api";
import { BackupCodesDisplay } from "./backup-codes-display";

interface EnableResponse {
  totpURI: string;
  backupCodes: string[];
}

interface Props {
  onComplete: () => void;
}

type Stage = "intro" | "enter-code" | "show-codes" | "done";

export function TwoFactorSetup({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>("intro");
  const [secret, setSecret] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // Better Auth requires the user's password to enable 2FA. We surface this
      // as a separate confirmation step for forced-enrollment because the user
      // is already signed in but hasn't re-confirmed their identity.
      const password = window.prompt(
        "Please confirm your password to enable 2FA:",
      );
      if (!password) {
        setBusy(false);
        return;
      }
      const res = await apiFetch<EnableResponse>("/auth/two-factor/enable", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setBackupCodes(res.backupCodes);
      // Extract the secret from otpauth:// URI for display fallback.
      const params = new URL(res.totpURI).searchParams;
      setSecret(params.get("secret") ?? "");
      const qr = await QRCode.toDataURL(res.totpURI);
      setQrDataUrl(qr);
      setStage("enter-code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start setup");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/two-factor/verify-totp", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setStage("show-codes");
    } catch {
      setError("Invalid code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    setStage("done");
    onComplete();
  }

  if (stage === "intro") {
    return (
      <div>
        <p className="text-sm text-gray-700">
          Two-factor authentication adds a second step to sign-in using a code from
          an authenticator app like Google Authenticator, 1Password, or Authy.
        </p>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Starting..." : "Set up 2FA"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (stage === "enter-code") {
    return (
      <div>
        <h3 className="font-semibold">Scan the QR code</h3>
        <p className="mt-1 text-sm text-gray-700">
          Open your authenticator app and scan this code, then enter the 6-digit
          code it shows.
        </p>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="TOTP QR code"
            className="my-3 h-48 w-48 border"
          />
        )}
        <details className="text-xs text-gray-600">
          <summary>Can't scan? Enter the secret manually</summary>
          <code className="mt-1 block break-all rounded bg-gray-100 p-2">{secret}</code>
        </details>
        <form onSubmit={verify} className="mt-4 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded border px-3 py-2 font-mono"
            autoComplete="one-time-code"
            required
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Verifying..." : "Verify"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (stage === "show-codes") {
    return <BackupCodesDisplay codes={backupCodes} onAcknowledge={finish} />;
  }

  return <p className="text-sm text-green-700">2FA is now enabled.</p>;
}
```

- [ ] **Step 3: Manually verify component compiles**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/two-factor-setup.tsx apps/web/src/components/backup-codes-display.tsx
git commit -m "feat(web): TwoFactorSetup and BackupCodesDisplay components"
```

---

## Task 14: Web — Settings Security page

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/settings/security/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/settings/security/security-section.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/settings/page.tsx` (add link to Security)

- [ ] **Step 1: Implement the section component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { TwoFactorSetup } from "@/components/two-factor-setup";

interface Status {
  enabled: boolean;
  requiredByOrg: boolean;
}

interface Props {
  isOwner: boolean;
}

export function SecuritySection({ isOwner }: Props) {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [orgRequire, setOrgRequire] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Status>("/two-factor/status")
      .then((s) => {
        setStatus(s);
        setOrgRequire(s.requiredByOrg);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function disable() {
    const code = window.prompt(
      "Enter your current 6-digit code to confirm disabling 2FA:",
    );
    if (!code) return;
    setBusy(true);
    try {
      await apiFetch("/auth/two-factor/disable", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setStatus({ enabled: false, requiredByOrg: orgRequire });
      success("2FA disabled");
    } catch {
      showError("Failed to disable 2FA — check the code and try again");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCodes() {
    const code = window.prompt(
      "Enter your current 6-digit code to regenerate recovery codes:",
    );
    if (!code) return;
    const ok = await confirm({
      title: "Regenerate recovery codes?",
      message: "Existing recovery codes will stop working immediately.",
      confirmText: "Regenerate",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ backupCodes: string[] }>(
        "/auth/two-factor/generate-backup-codes",
        {
          method: "POST",
          body: JSON.stringify({ code }),
        },
      );
      window.alert(
        "New recovery codes (save them now — they are shown only once):\n\n" +
          res.backupCodes.join("\n"),
      );
    } catch {
      showError("Failed to regenerate codes");
    } finally {
      setBusy(false);
    }
  }

  async function toggleOrgRequire(next: boolean) {
    setBusy(true);
    try {
      // SystemSettings is updated via the existing settings endpoint.
      await apiFetch("/settings", {
        method: "PUT",
        body: JSON.stringify({ requireTwoFactor: next }),
      });
      setOrgRequire(next);
      success(next ? "2FA now required for staff" : "2FA requirement removed");
    } catch {
      showError("Failed to update org policy");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!status) return <p className="text-sm text-red-600">Failed to load status</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        {status.enabled ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-green-700">2FA is enabled on your account.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={regenerateCodes}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Regenerate recovery codes
              </button>
              {!status.requiredByOrg && (
                <button
                  type="button"
                  onClick={disable}
                  disabled={busy}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Disable 2FA
                </button>
              )}
              {status.requiredByOrg && (
                <span
                  className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-500"
                  title="Your organization requires 2FA — disabling is not allowed."
                >
                  Required by org policy
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <TwoFactorSetup
              onComplete={() => setStatus({ enabled: true, requiredByOrg: orgRequire })}
            />
          </div>
        )}
      </section>

      {isOwner && (
        <section className="border-t pt-4">
          <h2 className="text-lg font-semibold">Org policy</h2>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={orgRequire}
              onChange={(e) => toggleOrgRequire(e.target.checked)}
              disabled={busy}
            />
            <span className="text-sm">
              Require 2FA for staff (owners and admins). Clients are not affected.
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

```tsx
import { getCurrentMember } from "@/lib/server-session";
import { SecuritySection } from "./security-section";

export default async function SecuritySettingsPage() {
  const member = await getCurrentMember();
  const isOwner = member?.role === "owner";
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Security</h1>
      <p className="mt-1 text-sm text-gray-600">
        Manage two-factor authentication and org-wide security policies.
      </p>
      <div className="mt-6">
        <SecuritySection isOwner={isOwner} />
      </div>
    </div>
  );
}
```

If `@/lib/server-session` does not exist or does not expose `getCurrentMember`, replace its import with whatever helper is already used (e.g., look in `apps/web/src/app/(dashboard)/dashboard/settings/account/page.tsx` to see how the active member's role is derived) — keep the same approach used by neighboring pages.

- [ ] **Step 3: Add a link to the Security page**

In `apps/web/src/app/(dashboard)/dashboard/settings/page.tsx`, add a list-item linking to `/dashboard/settings/security` next to the existing Account/Billing entries. Match the existing list format exactly.

- [ ] **Step 4: Verify**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/dashboard/settings/security apps/web/src/app/(dashboard)/dashboard/settings/page.tsx
git commit -m "feat(web): Security settings page with 2FA controls"
```

---

## Task 15: Web — Settings PUT must accept `requireTwoFactor`

**Files:**
- Modify: `apps/api/src/settings/settings.dto.ts`
- Modify: `apps/api/src/settings/settings.service.ts`

The Security page submits `PUT /settings` with `{ requireTwoFactor: boolean }`. The settings service currently whitelists fields; we need to add this one.

- [ ] **Step 1: Add to the DTO**

In `apps/api/src/settings/settings.dto.ts`, find the `UpdateSettingsDto` class and add:

```ts
@IsOptional()
@IsBoolean()
requireTwoFactor?: boolean;
```

Make sure `IsBoolean` is imported from `class-validator` if not already.

- [ ] **Step 2: Pass it through in the service**

In `apps/api/src/settings/settings.service.ts`, inside `updateSettings`, in the block that copies non-sensitive fields, add:

```ts
if (dto.requireTwoFactor !== undefined) data.requireTwoFactor = dto.requireTwoFactor;
```

Place it next to the existing similar lines.

- [ ] **Step 3: Verify**

Run: `cd apps/api && bun test src/settings`
Expected: existing tests still pass. (No new tests required — the field plumbing is trivial.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/settings/settings.dto.ts apps/api/src/settings/settings.service.ts
git commit -m "feat(api): allow updating requireTwoFactor via PUT /settings"
```

---

## Task 16: Web — Login form handles `twoFactorRedirect`

**Files:**
- Modify: `apps/web/src/app/(auth)/login/login-form.tsx`

When the password is correct and 2FA is enabled, Better Auth returns `{ twoFactorRedirect: true }` instead of issuing the session cookie. The login form must handle this and route to `/login/2fa`.

- [ ] **Step 1: Read the existing login submit handler**

Run: `grep -n "signIn\|twoFactor\|router.push" apps/web/src/app/(auth)/login/login-form.tsx`
Identify where the success path runs `router.push("/dashboard")`.

- [ ] **Step 2: Branch on the response shape**

Wrap the existing API call so its JSON body is inspected. Pseudocode (adapt to the actual call site):

```ts
const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const body = await res.json();
if (!res.ok) {
  setError(body.message ?? "Sign-in failed");
  return;
}
if (body.twoFactorRedirect) {
  router.push("/login/2fa");
  return;
}
router.push(redirectTo ?? "/dashboard");
```

If the existing handler uses Better Auth's client SDK (`authClient.signIn.email`), use the equivalent shape — Better Auth returns the same flag.

- [ ] **Step 3: Manually verify**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(auth)/login/login-form.tsx
git commit -m "feat(web): redirect to 2FA challenge on twoFactorRedirect"
```

---

## Task 17: Web — Login challenge page

**Files:**
- Create: `apps/web/src/app/(auth)/login/2fa/page.tsx`
- Create: `apps/web/src/app/(auth)/login/2fa/two-factor-form.tsx`

- [ ] **Step 1: Implement the page**

```tsx
import { TwoFactorForm } from "./two-factor-form";

export default function TwoFactorChallengePage() {
  return (
    <div className="mx-auto mt-16 max-w-md p-6">
      <h1 className="text-2xl font-bold">Two-factor authentication</h1>
      <p className="mt-1 text-sm text-gray-600">
        Enter the 6-digit code from your authenticator app.
      </p>
      <div className="mt-6">
        <TwoFactorForm />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the form**

```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") ?? "/dashboard";
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path =
        mode === "totp"
          ? "/api/auth/two-factor/verify-totp"
          : "/api/auth/two-factor/verify-backup-code";
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, trustDevice: trust }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? "Invalid code");
        return;
      }
      router.push(redirectTo);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="text"
        inputMode={mode === "totp" ? "numeric" : "text"}
        pattern={mode === "totp" ? "\\d{6}" : undefined}
        maxLength={mode === "totp" ? 6 : 32}
        placeholder={mode === "totp" ? "000000" : "Recovery code"}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full rounded border px-3 py-2 font-mono"
        autoComplete="one-time-code"
        autoFocus
        required
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
        />
        Trust this device for 30 days
      </label>
      <button
        type="submit"
        disabled={busy || !code}
        className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "totp" ? "backup" : "totp"));
          setCode("");
          setError(null);
        }}
        className="block w-full text-center text-sm text-blue-700 hover:underline"
      >
        {mode === "totp" ? "Use a recovery code instead" : "Use authenticator app instead"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(auth)/login/2fa
git commit -m "feat(web): 2FA login challenge page with recovery-code fallback"
```

---

## Task 18: Web — Forced enrollment redirect on TWO_FACTOR_REQUIRED

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/app/(auth)/2fa/setup/page.tsx`

- [ ] **Step 1: Intercept TWO_FACTOR_REQUIRED in apiFetch**

In `apps/web/src/lib/api.ts`, after the existing CSRF retry block in `apiFetch`, add a 403-with-code check before the `if (!res.ok)` block (or wherever the JSON is parsed):

```ts
if (res.status === 403) {
  const cloned = res.clone();
  const body = await cloned.json().catch(() => ({}));
  if ((body as { code?: string }).code === "TWO_FACTOR_REQUIRED") {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/2fa/setup")) {
      window.location.href = "/2fa/setup";
    }
    throw new Error("Two-factor authentication is required");
  }
}
```

Place it where errors are normalized today. The exact line depends on the existing structure — read the file first.

- [ ] **Step 2: Implement the forced setup page**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { TwoFactorSetup } from "@/components/two-factor-setup";

export default function ForcedTwoFactorSetupPage() {
  const router = useRouter();
  return (
    <div className="mx-auto mt-12 max-w-2xl p-6">
      <h1 className="text-2xl font-bold">Two-factor authentication required</h1>
      <p className="mt-2 text-sm text-gray-700">
        Your organization requires 2FA for staff accounts. Please set it up to continue.
      </p>
      <div className="mt-6">
        <TwoFactorSetup onComplete={() => router.push("/dashboard")} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/app/(auth)/2fa
git commit -m "feat(web): force enrollment on TWO_FACTOR_REQUIRED"
```

---

## Task 19: Web — Team page Disable 2FA admin action

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/clients/team-section.tsx`

The exact filename may vary. Find the team list with:
`grep -rn "team@example.com\|invite.*team" apps/web/src/app/(dashboard)/dashboard/clients`
The component that renders the team list rows is the target.

- [ ] **Step 1: Read the existing row component**

Find where each member row is rendered. Note the existing actions (e.g., remove, change role).

- [ ] **Step 2: Add a Disable 2FA action**

For each row, after the existing role/remove actions, add (only when the *target's* `twoFactorEnabled` is true):

```tsx
{member.twoFactorEnabled && (
  <button
    type="button"
    onClick={async () => {
      const ok = await confirm({
        title: `Disable 2FA for ${member.name}?`,
        message:
          "Use only when the user has lost both their authenticator device and recovery codes. They will be able to sign in with just their password.",
        confirmText: "Disable 2FA",
      });
      if (!ok) return;
      try {
        await apiFetch(`/two-factor/admin/${member.userId}`, { method: "DELETE" });
        success(`2FA disabled for ${member.name}`);
        refetch();
      } catch {
        showError("Failed to disable 2FA");
      }
    }}
    className="text-xs text-red-700 hover:underline"
  >
    Disable 2FA
  </button>
)}
```

The team list endpoint must include `twoFactorEnabled` for each member. If it does not, also modify the endpoint that powers the team list (likely `apps/api/src/clients/clients.service.ts` `findTeam`-style method) to `select` `user.twoFactorEnabled` and surface it on the row.

- [ ] **Step 3: If the API needs changes, update it and add a unit test**

If `clients.service.ts` is the source: extend the team query to include `twoFactorEnabled` from the related `User`. Add an assertion in the existing service spec that the field is present in returned rows.

- [ ] **Step 4: Verify**

Run: `cd apps/api && bun test src/clients`
Run: `cd apps/web && bunx tsc --noEmit`
Expected: tests pass, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/dashboard/clients apps/api/src/clients
git commit -m "feat: surface team 2FA status and admin Disable 2FA action"
```

---

## Task 20: E2E tests

**Files:**
- Create: `e2e/tests/two-factor.e2e.ts`

- [ ] **Step 1: Implement the test file**

```ts
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { authenticator } from "otplib";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

// Helper: create a fresh user via signup so each test gets a clean slate.
async function createUser() {
  const ctx = await playwrightRequest.newContext();
  const email = `2fa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "TestPass123!";
  const res = await ctx.post(`${API}/onboarding/signup`, {
    data: { name: "2FA User", email, password, orgName: "2FA Test Org" },
  });
  if (!res.ok()) throw new Error(`signup failed: ${await res.text()}`);
  // Complete the setup wizard so the dashboard loads.
  await ctx.get(`${API}/setup/status`);
  const cookies = await ctx.storageState();
  const csrf =
    cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  await ctx.post(`${API}/setup/complete`, { headers: { "x-csrf-token": csrf } });
  return { ctx, email, password };
}

// Helper: enable 2FA via the API and return the secret + backup codes.
async function enableTwoFactor(ctx: Awaited<ReturnType<typeof createUser>>["ctx"], password: string) {
  const cookies = await ctx.storageState();
  const csrf = cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  const enableRes = await ctx.post(`${API}/auth/two-factor/enable`, {
    data: { password },
    headers: { "x-csrf-token": csrf },
  });
  if (!enableRes.ok()) throw new Error(`enable failed: ${await enableRes.text()}`);
  const body = (await enableRes.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
  const code = authenticator.generate(secret);
  const verifyRes = await ctx.post(`${API}/auth/two-factor/verify-totp`, {
    data: { code },
    headers: { "x-csrf-token": csrf },
  });
  if (!verifyRes.ok()) throw new Error(`verify failed: ${await verifyRes.text()}`);
  return { secret, backupCodes: body.backupCodes };
}

test.describe("Two-factor authentication", () => {
  test("opt-in: enable 2FA, log out, log back in with TOTP", async ({ browser }) => {
    const { email, password } = await createUser();

    // Sign in via UI
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);

    // Go to security settings and enable 2FA
    await page.goto("/dashboard/settings/security");
    page.once("dialog", async (d) => d.accept(password));
    await page.getByRole("button", { name: /set up 2fa/i }).click();

    // Read the secret from the displayed manual fallback
    await page.getByText(/can't scan/i).click();
    const secret = (await page.locator("code").innerText()).trim();
    const code = authenticator.generate(secret);

    await page.getByPlaceholder("000000").fill(code);
    await page.getByRole("button", { name: /verify/i }).click();
    await expect(page.getByText(/save your recovery codes/i)).toBeVisible();
    await page.getByRole("button", { name: /i've saved these/i }).click();

    // Log out, log back in — challenge must appear
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);

    const nextCode = authenticator.generate(secret);
    await page.getByPlaceholder("000000").fill(nextCode);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/dashboard/);
  });

  test("trusted device skips challenge on next login", async ({ browser }) => {
    const { ctx, email, password } = await createUser();
    const { secret } = await enableTwoFactor(ctx, password);

    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);
    await page.getByPlaceholder("000000").fill(authenticator.generate(secret));
    await page.getByLabel(/trust this device/i).check();
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/dashboard/);

    // Log out (clear session cookie only — keep trust-device cookie) and log back in
    const cookies = await page.context().cookies();
    await page.context().clearCookies();
    for (const c of cookies) {
      if (c.name.includes("trust")) {
        await page.context().addCookies([c]);
      }
    }
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    // Should land on /dashboard, not /login/2fa
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test("recovery code logs in once and cannot be reused", async ({ browser }) => {
    const { ctx, email, password } = await createUser();
    const { backupCodes } = await enableTwoFactor(ctx, password);
    const code = backupCodes[0];

    // First use — succeeds
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);
    await page.getByRole("button", { name: /use a recovery code/i }).click();
    await page.getByPlaceholder(/recovery code/i).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForURL(/\/dashboard/);

    // Second use — must be rejected
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/login\/2fa/);
    await page.getByRole("button", { name: /use a recovery code/i }).click();
    await page.getByPlaceholder(/recovery code/i).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();
  });

  test("org enforcement redirects unenrolled staff to /2fa/setup", async ({ browser }) => {
    const { ctx, email, password } = await createUser();

    // Owner enables the requirement (without enrolling themselves first to keep
    // the test focused — the page should still let them turn it on; if not,
    // adjust the order so they enroll first).
    const cookies = await ctx.storageState();
    const csrf = cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
    await ctx.put(`${API}/settings`, {
      data: { requireTwoFactor: true },
      headers: { "x-csrf-token": csrf },
    });

    // New browser context as the same user — should be redirected.
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    // Hit a protected page
    await page.goto("/dashboard");
    await page.waitForURL(/\/2fa\/setup/);
    await expect(page.getByText(/two-factor authentication required/i)).toBeVisible();
  });

  test("clients (member role) are never forced to enroll", async ({ browser }) => {
    // This test requires a client invitation flow; mark as fixme if not yet
    // wired into helpers, otherwise execute end-to-end:
    //  1. Owner enables requireTwoFactor
    //  2. Owner invites a client; client accepts
    //  3. Client signs in and reaches /portal — must NOT redirect to /2fa/setup
    test.fixme(
      true,
      "Pending client-invite test helper — see e2e/tests/helpers.ts for the existing invitation pattern",
    );
  });
});
```

- [ ] **Step 2: Run the e2e suite**

From repo root:
```bash
bun run dev   # in one terminal — keep running
# in another terminal:
bun run test:e2e -- --grep "Two-factor"
```
Expected: 4 of 5 tests pass; the last is `fixme` pending a helper.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/two-factor.e2e.ts
git commit -m "test(e2e): two-factor auth flows"
```

---

## Task 21: Final smoke + lint

- [ ] **Step 1: Run full unit suite**

Run from repo root:
```bash
cd apps/api && bun test
```
Expected: all tests pass.

- [ ] **Step 2: TypeScript checks**

```bash
cd apps/api && bunx tsc --noEmit
cd apps/web && bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Lint**

```bash
cd apps/api && bun run lint
cd apps/web && bun run lint
```
Expected: clean (or only pre-existing warnings).

- [ ] **Step 4: Manual smoke test**

Run `bun run dev`, sign in as the seeded admin, go to `/dashboard/settings/security`, enable 2FA end-to-end with a real authenticator app, sign out, sign back in. Confirm the trust-device checkbox works on the next login.

- [ ] **Step 5: Final commit (if any leftover formatting)**

If lint/tsc made changes, commit them:
```bash
git add -A
git commit -m "chore: final formatting after 2FA feature"
```

---

## Self-review notes

- **Spec coverage:**
  - Setup flow → Tasks 13, 14
  - Login challenge → Tasks 16, 17
  - Trusted device 30 days → Task 17 (UI) + Better Auth plugin (Task 3)
  - Self-disable + regenerate codes → Task 14
  - Org enforcement → Tasks 1, 4, 5, 10, 15, 18
  - Admin disable for locked-out user → Tasks 6, 7, 8, 9, 19
  - CLI escape hatch → Tasks 11, 12
  - Pino audit log line → Task 7
  - Clients exempt from enforcement → Task 5 + Task 20 (test marked fixme; functional behavior is unit-tested)
  - All e2e scenarios in spec section 8 → Task 20

- **Type consistency:** `requireTwoFactor` (snake_case nowhere), `twoFactorEnabled`, `TWO_FACTOR_REQUIRED` error code, `disableForUser(actorUserId, targetUserId, organizationId)` signature consistent across service, controller spec, and controller.

- **No placeholders:** Every code block is concrete. The only soft references are "the existing login submit handler" (Task 16) and "the team list component" (Task 19) — those exist in the codebase but the file path varies enough to require a `grep` first; the task tells the engineer to read before writing.
