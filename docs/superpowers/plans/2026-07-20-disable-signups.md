# Disable Signups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ALLOW_SIGNUPS` env var that lets a self-hoster close public self-serve signup so no new organizations can be created.

**Architecture:** A string env flag (default `"true"`) is enforced server-side by a guard at the top of the onboarding signup handler (returns 403 when off), exposed to the frontend via the existing public `GET /health/config` endpoint, and consumed by the signup page to show a "signups disabled" message instead of the form. Login and the invitation `/accept-invite` flow are untouched.

**Tech Stack:** NestJS 11 (API), Next.js 15 + React 19 (web), Bun test runner (API unit tests), Playwright (e2e).

## Global Constraints

- Env var name: **`ALLOW_SIGNUPS`**, string flag following the `BILLING_ENABLED` convention.
- Default **`"true"`**: absent or any value other than `"false"` = signups enabled. Only the exact string `"false"` disables.
- Scope: block **only** `POST /onboarding/signup` (new-org self-serve). Do NOT touch login, `/accept-invite`, invitations, or billing.
- TypeScript: explicit types, no `any`. Every catch logs.
- e2e harness runs a **single shared API server** whose `global-setup` bootstraps the test account via `POST /onboarding/signup` — so the suite CANNOT run with `ALLOW_SIGNUPS=false` globally. Server-side enforcement is covered by an API unit test; the disabled UI is covered in e2e by intercepting the `/health/config` response with Playwright route mocking.

---

### Task 1: API enforcement guard + env docs

**Files:**
- Modify: `apps/api/src/onboarding/onboarding.controller.ts`
- Create: `apps/api/src/onboarding/onboarding.controller.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ConfigService.get(key, default)` (already injected as `this.config`), `ForbiddenException` from `@nestjs/common`.
- Produces: `POST /onboarding/signup` returns HTTP 403 `"Signups are disabled"` when `ALLOW_SIGNUPS !== "true"`, before any Better Auth call.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/onboarding/onboarding.controller.spec.ts`. The guard runs before any dependency is used, so stubs can be minimal. The "guard passes" case drives the handler into the Better Auth call and asserts it got past the guard (surfaces `BadRequestException`, not `ForbiddenException`).

```ts
import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import type { AuthService } from "../auth/auth.service";
import type { BillingService } from "../billing/billing.service";
import type { MailService } from "../mail/mail.service";
import type { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import type { SignupDto } from "./signup.dto";

const makeConfig = (vals: Record<string, string> = {}) =>
  ({ get: (key: string, def?: string) => vals[key] ?? def }) as unknown as ConfigService;

const makeLogger = () =>
  ({ error: mock(() => {}), warn: mock(() => {}), info: mock(() => {}) }) as unknown as never;

const makeRes = () =>
  ({ append: mock(() => {}), status: mock(() => {}) }) as unknown as Response;

const body: SignupDto = {
  name: "A",
  email: "a@b.com",
  password: "TestPass123!",
  orgName: "Acme",
} as SignupDto;

describe("OnboardingController signup gate", () => {
  it("throws ForbiddenException and never calls auth when ALLOW_SIGNUPS is false", async () => {
    const handler = mock(() => Promise.resolve(new Response()));
    const authService = { auth: { handler } } as unknown as AuthService;
    const controller = new OnboardingController(
      authService,
      {} as BillingService,
      makeConfig({ ALLOW_SIGNUPS: "false" }),
      {} as MailService,
      makeLogger(),
    );

    await expect(controller.signup(body, makeRes())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the gate (reaches Better Auth) when ALLOW_SIGNUPS is unset", async () => {
    const handler = mock(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: async () => ({ message: "boom" }),
        headers: { getSetCookie: () => [] },
      } as unknown as Response),
    );
    const authService = { auth: { handler } } as unknown as AuthService;
    const controller = new OnboardingController(
      authService,
      {} as BillingService,
      makeConfig(), // ALLOW_SIGNUPS unset -> defaults to enabled
      {} as MailService,
      makeLogger(),
    );

    await expect(controller.signup(body, makeRes())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/src/onboarding/onboarding.controller.spec.ts`
Expected: FAIL — the first test fails because signup currently proceeds and calls `handler` instead of throwing `ForbiddenException`.

- [ ] **Step 3: Add the guard**

In `apps/api/src/onboarding/onboarding.controller.ts`, add `ForbiddenException` to the existing `@nestjs/common` import:

```ts
import {
  Body,
  Controller,
  Post,
  Res,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
```

Then, as the FIRST statement inside `signup(...)` (before the `const baseUrl = ...` line), add:

```ts
    if (this.config.get("ALLOW_SIGNUPS") === "false") {
      throw new ForbiddenException("Signups are disabled");
    }
```

This matches the `/health/config` semantics exactly (Task 2): enabled unless the value is exactly `"false"`; unset defaults to enabled.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/src/onboarding/onboarding.controller.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Document the env var**

In `.env.example`, add after line 94 (`# SIGNUP_THROTTLE_LIMIT="5"`):

```
# Set to "false" to disable public self-serve signup (blocks new organizations).
# Login and invited-client onboarding are unaffected. Default: signups enabled.
# ALLOW_SIGNUPS="true"
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/onboarding/onboarding.controller.ts apps/api/src/onboarding/onboarding.controller.spec.ts .env.example
git commit -m "feat(api): gate signup endpoint behind ALLOW_SIGNUPS (#54)"
```

---

### Task 2: Expose `signupEnabled` via `/health/config`

**Files:**
- Modify: `apps/api/src/health.controller.ts:20-24`
- Modify: `apps/api/src/health.controller.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get(key, default)`.
- Produces: `GET /health/config` response now includes `signupEnabled: boolean` alongside `billingEnabled`.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/health.controller.spec.ts`, add this block inside the top-level `describe("HealthController", ...)` (e.g. after the "throws 503" test):

```ts
  describe("getConfig", () => {
    it("reports signupEnabled true by default", () => {
      const controller = new HealthController(
        makePrisma({ dbOk: true }) as unknown as PrismaService,
        makeConfig(),
      );
      expect(controller.getConfig().signupEnabled).toBe(true);
    });

    it("reports signupEnabled false when ALLOW_SIGNUPS is 'false'", () => {
      const controller = new HealthController(
        makePrisma({ dbOk: true }) as unknown as PrismaService,
        makeConfig({ ALLOW_SIGNUPS: "false" }),
      );
      expect(controller.getConfig().signupEnabled).toBe(false);
    });
  });
```

Note: the existing `makeConfig` helper is `({ get: (key) => vals[key] })` — it ignores any default arg. `getConfig` uses an explicit `!== "false"` check (see Step 3), which is correct under this stub and in production (unset → `undefined !== "false"` → `true`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/src/health.controller.spec.ts`
Expected: FAIL — `getConfig().signupEnabled` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the field**

In `apps/api/src/health.controller.ts`, change `getConfig()` to:

```ts
  @Public()
  @Get("config")
  getConfig() {
    return {
      billingEnabled: this.config.get("BILLING_ENABLED") === "true",
      signupEnabled: this.config.get("ALLOW_SIGNUPS") !== "false",
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/src/health.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/health.controller.ts apps/api/src/health.controller.spec.ts
git commit -m "feat(api): expose signupEnabled in /health/config (#54)"
```

---

### Task 3: Frontend — config type + disabled signup UI

**Files:**
- Modify: `apps/web/src/lib/app-config.ts`
- Modify: `apps/web/src/app/(auth)/signup/page.tsx`

**Interfaces:**
- Consumes: `useAppConfig()` returning `AppConfig | null` where `AppConfig` now has `signupEnabled: boolean`.
- Produces: `/signup` renders a "Signups are disabled" screen (heading + "Go to sign in" link, no form) when `config?.signupEnabled === false`.

- [ ] **Step 1: Add `signupEnabled` to the config type**

In `apps/web/src/lib/app-config.ts`, update the interface and the catch fallback:

```ts
export interface AppConfig {
  billingEnabled: boolean;
  signupEnabled: boolean;
}
```

and in `fetchConfig`'s `.catch(...)`:

```ts
      .catch(() => {
        pending = null; // allow retry on next mount
        return { billingEnabled: false, signupEnabled: true };
      });
```

- [ ] **Step 2: Render the disabled state on the signup page**

In `apps/web/src/app/(auth)/signup/page.tsx`, inside `SignupPage`, add a derived flag right after the existing `billingEnabled` line (currently line 167):

```tsx
  const signupsDisabled = config?.signupEnabled === false;
```

Then add this early return immediately before the existing `if (step === "plan") {` block (currently line 292) — after all hooks so hook order stays stable:

```tsx
  if (signupsDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold">Signups are disabled</h1>
          <p className="text-[var(--muted-foreground)]">
            This Atrium instance isn&apos;t accepting new signups. If you already
            have an account, you can sign in.
          </p>
          <Link
            href="/login"
            className="inline-block py-2 px-4 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }
```

`Link` is already imported at the top of the file. No other changes.

- [ ] **Step 3: Verify the app typechecks/builds**

Run: `bun run --filter @atrium/web build`
Expected: build succeeds with no TypeScript errors. (A full build is the reliable signal here; there is no separate web unit-test runner.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/app-config.ts "apps/web/src/app/(auth)/signup/page.tsx"
git commit -m "feat(web): show disabled state on signup page when signups are off (#54)"
```

---

### Task 4: e2e coverage for the disabled UI

**Files:**
- Create: `e2e/tests/signup-disabled.e2e.ts`

**Interfaces:**
- Consumes: the running web app at `baseURL` (`http://localhost:3000`) and the `/signup` route; intercepts `**/api/health/config` to control `signupEnabled` without changing API env.
- Produces: passing Playwright spec proving the disabled message shows when the flag is off and the form shows when it is on.

- [ ] **Step 1: Write the e2e test**

Create `e2e/tests/signup-disabled.e2e.ts`:

```ts
import { test, expect } from "@playwright/test";

// The shared API server bootstraps the suite via POST /onboarding/signup, so it
// runs with signups enabled. To exercise the disabled UI without a second API,
// intercept the public /health/config response the signup page reads.
test.describe("signup disabled state", () => {
  // Visit as a logged-out user — /signup is public.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows the disabled message when signups are off", async ({ page }) => {
    await page.route("**/api/health/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ billingEnabled: false, signupEnabled: false }),
      }),
    );

    await page.goto("/signup");

    await expect(
      page.getByRole("heading", { name: /signups are disabled/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /go to sign in/i }),
    ).toBeVisible();
    // The account form must not render.
    await expect(page.getByLabel(/agency \/ company name/i)).toHaveCount(0);
  });

  test("shows the signup form when signups are enabled", async ({ page }) => {
    await page.route("**/api/health/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ billingEnabled: false, signupEnabled: true }),
      }),
    );

    await page.goto("/signup");

    await expect(
      page.getByRole("heading", { name: /create your account/i }),
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `bun run test:e2e -- signup-disabled`
Expected: PASS (2 tests). Playwright auto-starts the web + API servers if not already running.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/signup-disabled.e2e.ts
git commit -m "test(e2e): cover disabled signup state (#54)"
```

---

### Task 5: Gate authenticated org creation on `ALLOW_SIGNUPS`

**Context:** The signup guard (Task 1) only blocks `POST /onboarding/signup`. But the Better Auth proxy (`apps/api/src/auth/auth.controller.ts` → `@All("*path")`) also exposes `POST /api/auth/organization/create`, which any already-authenticated user (including an invited client) can call to create a new org — bypassing the signup gate. This task closes that path so a disabled instance truly stays "one company per host".

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` (the `organization({ ... })` plugin config, around line 130)
- Modify: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `this.config.get("ALLOW_SIGNUPS")`; Better Auth `organization()` plugin option `allowUserToCreateOrganization: boolean | ((user) => Awaitable<boolean>)`.
- Produces: when `ALLOW_SIGNUPS === "false"`, `POST /api/auth/organization/create` is rejected by Better Auth; otherwise unchanged.

**Verified against better-auth@1.4.18:** the option is named `allowUserToCreateOrganization`; in `dist/plugins/organization/routes/crud-org.mjs` the route computes `canCreateOrg = ... options.allowUserToCreateOrganization === void 0 ? true : options.allowUserToCreateOrganization`, so `false` blocks and `undefined` (unset) defaults to allowed. The resolved value is introspectable at `auth.options.plugins.find(p => p.id === "organization").options.allowUserToCreateOrganization`, which the unit test uses.

**Note on the signup flow:** `onboarding.controller.ts` creates its org through this same Better Auth path. That is fine — when signups are enabled the option is `true` so signup works; when disabled, the Task 1 guard 403s before org creation is ever reached. No conflict.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/auth/auth.service.spec.ts`, add this block (it builds its own config mock so `ALLOW_SIGNUPS` can vary, reusing the file's existing `mockPrisma`, `mockMail`, `mockBilling`):

```ts
  describe("organization creation gate", () => {
    function makeServiceWith(allowSignups: string | undefined): AuthService {
      const config = {
        get: mock((key: string, fallback?: string) => {
          if (key === "WEB_URL") return "http://localhost:3000";
          if (key === "API_URL") return "http://localhost:3001";
          if (key === "ALLOW_SIGNUPS") return allowSignups;
          return fallback;
        }),
        getOrThrow: mock((key: string) => {
          if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
          throw new Error(`Missing ${key}`);
        }),
      };
      return new AuthService(
        config as unknown as ConfigService,
        mockPrisma as unknown as PrismaService,
        mockMail as unknown as MailService,
        mockBilling as unknown as BillingService,
      );
    }

    function orgCreateOption(service: AuthService): unknown {
      interface OrgPlugin {
        id: string;
        options?: { allowUserToCreateOrganization?: unknown };
      }
      interface AuthWithOptions {
        options: { plugins: OrgPlugin[] };
      }
      const plugins = (service.auth as unknown as AuthWithOptions).options.plugins;
      return plugins.find((p) => p.id === "organization")?.options
        ?.allowUserToCreateOrganization;
    }

    it("blocks org creation when ALLOW_SIGNUPS is 'false'", () => {
      expect(orgCreateOption(makeServiceWith("false"))).toBe(false);
    });

    it("allows org creation when ALLOW_SIGNUPS is unset", () => {
      expect(orgCreateOption(makeServiceWith(undefined))).toBe(true);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/api/src/auth/auth.service.spec.ts`
Expected: FAIL — the two new tests fail because `allowUserToCreateOrganization` is currently unset (`undefined`), so it is neither `false` nor `true`.

- [ ] **Step 3: Add the option**

In `apps/api/src/auth/auth.service.ts`, inside the `organization({ ... })` call, add `allowUserToCreateOrganization` as the FIRST property (immediately after `organization({`, before `sendInvitationEmail`):

```ts
        organization({
          allowUserToCreateOrganization:
            this.config.get("ALLOW_SIGNUPS") !== "false",
          sendInvitationEmail: async ({ invitation, inviter, organization }) => {
```

Leave the rest of the plugin config unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/api/src/auth/auth.service.spec.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.spec.ts
git commit -m "feat(api): block authenticated org creation when signups disabled (#54)"
```

---

## Self-Review

**Spec coverage:**
- `ALLOW_SIGNUPS` env var, default enabled, only `"false"` disables → Task 1 (guard: `=== "false"`) + Task 2 (config: `!== "false"`). Identical semantics: enabled unless the value is exactly `"false"`; unset defaults to enabled. ✅
- API 403 enforcement before any user/org creation → Task 1. ✅
- Expose `signupEnabled` on `/health/config` → Task 2. ✅
- Frontend `AppConfig.signupEnabled` + fail-open default → Task 3 Step 1. ✅
- Signup page disabled message → Task 3 Step 2. ✅
- `.env.example` docs → Task 1 Step 5. ✅
- e2e coverage (disabled + enabled UI) → Task 4. ✅
- Untouched login/invite/billing → no tasks modify them. ✅

**Placeholder scan:** No TBD/TODO; all steps contain concrete code and commands. ✅

**Type consistency:** `signupEnabled: boolean` used identically in `AppConfig` (Task 3) and the `/health/config` response (Task 2). Guard throws `ForbiddenException` (Task 1) matching the spec's 403. `useAppConfig()` returns `AppConfig | null`, and the page guards with `config?.signupEnabled === false`. Server guard (`=== "false"`) and config flag (`!== "false"`) use identical `"false"`-means-disabled semantics, so the UI and the enforcement never disagree. ✅
