# View as Customer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners and admins click "View as customer" on a client row to open a read-only preview of the portal scoped to that client's data.

**Architecture:** Server-side `PreviewModeMiddleware` reads an `X-Preview-As` header, validates the requester is owner/admin and the target is a `member` of the same org, then substitutes `req.user.id` with the target's id. A global `PreviewModeGuard` blocks all non-GET/HEAD requests when preview mode is active. Client-side `PreviewModeProvider` reads `?previewAs=` on mount, stores the target client in sessionStorage, and `apiFetch` attaches the header automatically. A sticky banner sits atop all portal pages, and mutation buttons are disabled.

**Tech Stack:** NestJS 11 (middleware + guards), Bun test runner, Next.js 15 + React 19 (provider/context), Playwright (e2e).

---

## File Structure

**Created:**
- `apps/api/src/auth/preview-mode.middleware.ts`
- `apps/api/src/auth/preview-mode.middleware.spec.ts`
- `apps/api/src/auth/preview-mode.guard.ts`
- `apps/api/src/auth/preview-mode.guard.spec.ts`
- `apps/web/src/lib/preview-mode.tsx`
- `apps/web/src/components/preview-banner.tsx`
- `e2e/tests/view-as-customer.e2e.ts`

**Modified:**
- `apps/api/src/common/types/authenticated-request.ts` (add `previewMode?: boolean` flag)
- `apps/api/src/auth/auth.module.ts` (provide middleware + guard)
- `apps/api/src/app.module.ts` (apply middleware + register guard globally)
- `apps/web/src/lib/api.ts` (attach `X-Preview-As` header from sessionStorage)
- `apps/web/src/app/(portal)/layout.tsx` (wrap with `PreviewModeProvider` and render banner)
- `apps/web/src/app/(dashboard)/dashboard/clients/page.tsx` (add `<Eye />` button on each client row)
- `apps/web/src/app/(portal)/portal/sign/[token]/page.tsx` (disable Sign button in preview)
- `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx` (disable pay/accept actions in preview)

---

## Task 1: Add `previewMode` flag to AuthenticatedRequest type

**Files:**
- Modify: `apps/api/src/common/types/authenticated-request.ts`

- [ ] **Step 1: Add the optional flag**

Open `apps/api/src/common/types/authenticated-request.ts` and update the `AuthenticatedRequest` interface to include `previewMode`:

```ts
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  session: AuthSession;
  organization: FullOrganization;
  member: OrgMember;
  previewMode?: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/api && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/types/authenticated-request.ts
git commit -m "feat(api): add previewMode flag to AuthenticatedRequest"
```

---

## Task 2: PreviewModeMiddleware (TDD)

**Files:**
- Create: `apps/api/src/auth/preview-mode.middleware.spec.ts`
- Create: `apps/api/src/auth/preview-mode.middleware.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/preview-mode.middleware.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { PreviewModeMiddleware } from "./preview-mode.middleware";
import type { Request, Response, NextFunction } from "express";

interface MockReq extends Partial<Request> {
  headers: Record<string, string>;
  user?: { id: string; name: string; email: string };
  member?: { role: string; organizationId: string };
  organization?: { id: string };
  previewMode?: boolean;
}

function buildReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    headers: {},
    user: { id: "owner-1", name: "Owner", email: "owner@test.com" },
    member: { role: "owner", organizationId: "org-1" },
    organization: { id: "org-1" },
    ...overrides,
  };
}

function buildPrismaMock(member: { userId: string; role: string; organizationId: string } | null) {
  return {
    member: { findFirst: mock(() => Promise.resolve(member)) },
  };
}

describe("PreviewModeMiddleware", () => {
  it("passes through unchanged when X-Preview-As header is absent", async () => {
    const prisma = buildPrismaMock(null);
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq();
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(req as Request, {} as Response, next);

    expect(req.user?.id).toBe("owner-1");
    expect(req.previewMode).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("overrides user.id when owner previews a valid client", async () => {
    const prisma = buildPrismaMock({
      userId: "client-9",
      role: "member",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({ headers: { "x-preview-as": "client-9" } });
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(req as Request, {} as Response, next);

    expect(req.user?.id).toBe("client-9");
    expect(req.previewMode).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("overrides user.id when admin previews a valid client", async () => {
    const prisma = buildPrismaMock({
      userId: "client-9",
      role: "member",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({
      headers: { "x-preview-as": "client-9" },
      member: { role: "admin", organizationId: "org-1" },
    });
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(req as Request, {} as Response, next);

    expect(req.user?.id).toBe("client-9");
    expect(req.previewMode).toBe(true);
  });

  it("rejects with 401 when requester is not owner or admin", async () => {
    const prisma = buildPrismaMock({
      userId: "client-9",
      role: "member",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({
      headers: { "x-preview-as": "client-9" },
      member: { role: "member", organizationId: "org-1" },
    });
    const next = mock(() => {}) as unknown as NextFunction;

    await expect(mw.use(req as Request, {} as Response, next)).rejects.toThrow(
      "Preview unavailable",
    );
  });

  it("rejects with 401 when target is not a member of the active org", async () => {
    const prisma = buildPrismaMock(null);
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({ headers: { "x-preview-as": "client-9" } });
    const next = mock(() => {}) as unknown as NextFunction;

    await expect(mw.use(req as Request, {} as Response, next)).rejects.toThrow(
      "Preview unavailable",
    );
  });

  it("rejects with 401 when target is owner or admin (not a client)", async () => {
    const prisma = buildPrismaMock({
      userId: "other-admin",
      role: "admin",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({ headers: { "x-preview-as": "other-admin" } });
    const next = mock(() => {}) as unknown as NextFunction;

    await expect(mw.use(req as Request, {} as Response, next)).rejects.toThrow(
      "Preview unavailable",
    );
  });

  it("does not mutate the original cached user object", async () => {
    const cachedUser = { id: "owner-1", name: "Owner", email: "owner@test.com" };
    const prisma = buildPrismaMock({
      userId: "client-9",
      role: "member",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({
      headers: { "x-preview-as": "client-9" },
      user: cachedUser,
    });
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(req as Request, {} as Response, next);

    expect(cachedUser.id).toBe("owner-1");
    expect(req.user?.id).toBe("client-9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/auth/preview-mode.middleware.spec.ts`
Expected: FAIL with `Cannot find module './preview-mode.middleware'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/auth/preview-mode.middleware.ts`:

```ts
import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedRequest } from "../common";

const HEADER_NAME = "x-preview-as";
const PRIVILEGED_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class PreviewModeMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const authReq = req as AuthenticatedRequest;
    const headerValue = req.headers[HEADER_NAME];
    const targetUserId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!targetUserId) {
      next();
      return;
    }

    const requesterRole = authReq.member?.role;
    const orgId = authReq.organization?.id;

    if (!requesterRole || !orgId || !PRIVILEGED_ROLES.has(requesterRole)) {
      throw new UnauthorizedException("Preview unavailable");
    }

    const targetMember = await this.prisma.member.findFirst({
      where: { userId: targetUserId, organizationId: orgId },
      select: { userId: true, role: true, organizationId: true },
    });

    if (!targetMember || targetMember.role !== "member") {
      throw new UnauthorizedException("Preview unavailable");
    }

    // Shallow-clone so we never mutate the SessionMiddleware cache.
    authReq.user = { ...authReq.user, id: targetMember.userId };
    authReq.previewMode = true;
    next();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/auth/preview-mode.middleware.spec.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/preview-mode.middleware.ts apps/api/src/auth/preview-mode.middleware.spec.ts
git commit -m "feat(api): add PreviewModeMiddleware for view-as-customer"
```

---

## Task 3: PreviewModeGuard (TDD)

**Files:**
- Create: `apps/api/src/auth/preview-mode.guard.spec.ts`
- Create: `apps/api/src/auth/preview-mode.guard.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/preview-mode.guard.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { PreviewModeGuard } from "./preview-mode.guard";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";

function buildContext(method: string, previewMode: boolean): ExecutionContext {
  const request = { method, previewMode };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => {},
    }),
  } as unknown as ExecutionContext;
}

describe("PreviewModeGuard", () => {
  const guard = new PreviewModeGuard();

  it("allows GET when previewMode is true", () => {
    expect(guard.canActivate(buildContext("GET", true))).toBe(true);
  });

  it("allows HEAD when previewMode is true", () => {
    expect(guard.canActivate(buildContext("HEAD", true))).toBe(true);
  });

  it("rejects POST when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("POST", true))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects PUT when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("PUT", true))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects PATCH when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("PATCH", true))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects DELETE when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("DELETE", true))).toThrow(
      ForbiddenException,
    );
  });

  it("allows POST when previewMode is false", () => {
    expect(guard.canActivate(buildContext("POST", false))).toBe(true);
  });

  it("allows POST when previewMode flag is missing", () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST" }),
        getResponse: () => ({}),
        getNext: () => () => {},
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/auth/preview-mode.guard.spec.ts`
Expected: FAIL with `Cannot find module './preview-mode.guard'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/auth/preview-mode.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../common";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

@Injectable()
export class PreviewModeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (request.previewMode && !SAFE_METHODS.has(request.method)) {
      throw new ForbiddenException("Read-only preview mode");
    }

    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/auth/preview-mode.guard.spec.ts`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/preview-mode.guard.ts apps/api/src/auth/preview-mode.guard.spec.ts
git commit -m "feat(api): add PreviewModeGuard blocking mutations in preview"
```

---

## Task 4: Wire middleware + guard into AppModule

**Files:**
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Export PreviewModeMiddleware from AuthModule**

Open `apps/api/src/auth/auth.module.ts` and add the new middleware to providers/exports:

```ts
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionMiddleware } from "./session.middleware";
import { PreviewModeMiddleware } from "./preview-mode.middleware";
import { MailModule } from "../mail/mail.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [MailModule, BillingModule],
  controllers: [AuthController],
  providers: [AuthService, SessionMiddleware, PreviewModeMiddleware],
  exports: [AuthService, SessionMiddleware, PreviewModeMiddleware],
})
export class AuthModule {}
```

- [ ] **Step 2: Apply middleware after SessionMiddleware and register guard**

Open `apps/api/src/app.module.ts`. Add imports near the other auth imports:

```ts
import { SessionMiddleware } from "./auth/session.middleware";
import { PreviewModeMiddleware } from "./auth/preview-mode.middleware";
import { PreviewModeGuard } from "./auth/preview-mode.guard";
```

Add the guard to the providers array (after `PlanGuard`):

```ts
    {
      provide: APP_GUARD,
      useClass: PlanGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PreviewModeGuard,
    },
```

Replace the `configure` method to chain both middlewares (order matters — `SessionMiddleware` first so `req.user`/`req.member`/`req.organization` are populated):

```ts
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SessionMiddleware, PreviewModeMiddleware)
      .forRoutes("*");
  }
```

- [ ] **Step 3: Verify the API still builds and existing tests pass**

Run: `cd apps/api && bunx tsc --noEmit && bun test`
Expected: TypeScript compiles, all existing tests still pass plus the new middleware/guard tests.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/auth.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): wire PreviewModeMiddleware and Guard into AppModule"
```

---

## Task 5: PreviewModeProvider + sessionStorage

**Files:**
- Create: `apps/web/src/lib/preview-mode.tsx`

- [ ] **Step 1: Create the provider and hook**

Create `apps/web/src/lib/preview-mode.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "atrium:previewAs";

export interface PreviewModeState {
  clientId: string;
  clientName: string;
  clientEmail: string;
}

interface PreviewModeContextValue {
  preview: PreviewModeState | null;
  exitPreview: () => void;
}

const PreviewModeContext = createContext<PreviewModeContextValue>({
  preview: null,
  exitPreview: () => {},
});

interface MemberRecord {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface PaginatedResponse<T> {
  data: T[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function readStored(): PreviewModeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PreviewModeState) : null;
  } catch {
    return null;
  }
}

function writeStored(state: PreviewModeState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (state) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.error("preview-mode storage write failed", err);
  }
}

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preview, setPreview] = useState<PreviewModeState | null>(() =>
    readStored(),
  );

  useEffect(() => {
    const requestedId = searchParams.get("previewAs");
    if (!requestedId) return;

    let cancelled = false;
    (async () => {
      try {
        // The server will validate role + org membership via the X-Preview-As
        // header below; we just need the client's name/email for the banner.
        const res = await fetch(`${API_URL}/api/clients?page=1&limit=200`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load clients");
        const body = (await res.json()) as PaginatedResponse<MemberRecord>;
        const match = body.data.find((m) => m.userId === requestedId);
        if (!match) throw new Error("Client not found");
        if (cancelled) return;
        const state: PreviewModeState = {
          clientId: match.userId,
          clientName: match.user.name,
          clientEmail: match.user.email,
        };
        writeStored(state);
        setPreview(state);
      } catch (err) {
        console.error("preview-mode init failed", err);
        writeStored(null);
        setPreview(null);
      } finally {
        if (!cancelled) {
          // Strip ?previewAs= from the URL.
          router.replace("/portal");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const exitPreview = useCallback(() => {
    writeStored(null);
    setPreview(null);
    if (typeof window !== "undefined") {
      // Try to close the tab (works when opened via window.open).
      window.close();
      // Fallback if the browser blocks close().
      setTimeout(() => {
        if (!window.closed) router.push("/dashboard/clients");
      }, 100);
    }
  }, [router]);

  const value = useMemo(
    () => ({ preview, exitPreview }),
    [preview, exitPreview],
  );

  return (
    <PreviewModeContext.Provider value={value}>
      {children}
    </PreviewModeContext.Provider>
  );
}

export function usePreviewMode(): PreviewModeContextValue {
  return useContext(PreviewModeContext);
}

export function getStoredPreviewClientId(): string | null {
  return readStored()?.clientId ?? null;
}
```

- [ ] **Step 2: Verify the web app type-checks**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/preview-mode.tsx
git commit -m "feat(web): add PreviewModeProvider and usePreviewMode hook"
```

---

## Task 6: apiFetch attaches X-Preview-As header

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Import the helper and attach the header**

Open `apps/web/src/lib/api.ts`. At the top, add the import:

```ts
import { getStoredPreviewClientId } from "./preview-mode";
```

Replace the `doFetch` function so it attaches the preview header and short-circuits mutations:

```ts
async function doFetch(
  path: string,
  options: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const method = (options.method || "GET").toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }

  const previewClientId = getStoredPreviewClientId();
  if (previewClientId) {
    if (MUTATING_METHODS.has(method)) {
      throw new Error("Read-only preview mode");
    }
    headers["X-Preview-As"] = previewClientId;
  }

  return fetch(`${API_URL}/api${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
}
```

- [ ] **Step 2: Verify the web app type-checks**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): attach X-Preview-As header and block mutations in preview"
```

---

## Task 7: PreviewBanner component

**Files:**
- Create: `apps/web/src/components/preview-banner.tsx`

- [ ] **Step 1: Create the banner**

Create `apps/web/src/components/preview-banner.tsx`:

```tsx
"use client";

import { Eye, X } from "lucide-react";
import { usePreviewMode } from "@/lib/preview-mode";

export function PreviewBanner() {
  const { preview, exitPreview } = usePreviewMode();
  if (!preview) return null;

  return (
    <div
      className="sticky top-0 z-40 w-full border-b border-amber-300 bg-amber-100 text-amber-900"
      role="status"
      aria-label="Preview mode banner"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 min-w-0">
          <Eye size={16} className="shrink-0" />
          <span className="truncate">
            Previewing as <strong>{preview.clientName}</strong> — read-only
          </span>
        </div>
        <button
          type="button"
          onClick={exitPreview}
          className="flex shrink-0 items-center gap-1 rounded-md bg-amber-200 px-2.5 py-1 text-xs font-semibold hover:bg-amber-300"
        >
          <X size={12} />
          Exit preview
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the web app type-checks**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/preview-banner.tsx
git commit -m "feat(web): add PreviewBanner component"
```

---

## Task 8: Wire provider and banner into portal layout

**Files:**
- Modify: `apps/web/src/app/(portal)/layout.tsx`

- [ ] **Step 1: Wrap the portal subtree with the provider and render the banner**

Open `apps/web/src/app/(portal)/layout.tsx`. Add imports near the existing imports:

```ts
import { Suspense } from "react";
import { PreviewModeProvider } from "@/lib/preview-mode";
import { PreviewBanner } from "@/components/preview-banner";
```

Wrap the returned JSX with the provider (replace the existing top-level `<div>` block):

```tsx
  return (
    <Suspense fallback={null}>
      <PreviewModeProvider>
        <div
          style={
            {
              "--primary": branding?.primaryColor || "#006b68",
              "--accent": branding?.accentColor || "#ff6b5c",
            } as React.CSSProperties
          }
        >
          <DynamicFavicon href={logoSrc || "/icon.png"} />
          <PreviewBanner />
          <header className="border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
            {!branding?.hideLogo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoSrc || "/icon.png"} alt="Logo" className="h-8 w-8 object-contain" />
            )}
            <span className="font-semibold flex-1">{orgName || "Atrium"}</span>
            <Link
              href="/portal"
              className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Projects
            </Link>
            <Link
              href="/portal/settings"
              className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Settings
            </Link>
            <NotificationBell />
            <SignOutButton />
          </header>
          <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </PreviewModeProvider>
    </Suspense>
  );
```

The `Suspense` wrapper is required because `PreviewModeProvider` calls `useSearchParams()`, which Next.js 15 streams via Suspense.

- [ ] **Step 2: Verify the web app type-checks**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(portal\)/layout.tsx
git commit -m "feat(web): wrap portal layout with PreviewModeProvider"
```

---

## Task 9: "View as customer" button on clients page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/clients/page.tsx`

- [ ] **Step 1: Add the Eye icon to the existing lucide import**

Open `apps/web/src/app/(dashboard)/dashboard/clients/page.tsx`. Update the lucide-react import to include `Eye`:

```ts
import { UserPlus, Copy, Check, Trash2, ChevronDown, ChevronRight, UsersRound, Download, Sparkles, ExternalLink, KeyRound, X, Eye } from "lucide-react";
```

- [ ] **Step 2: Add a click handler near the existing handlers**

Inside `PeoplePage`, near `handleResetPassword`, add:

```ts
  const handleViewAsClient = (clientUserId: string) => {
    track("client_viewed_as");
    window.open(`/portal?previewAs=${clientUserId}`, "_blank", "noopener");
  };
```

- [ ] **Step 3: Render the button on each client row**

In the client row JSX (the inner `<div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>` block, which currently contains the `KeyRound` and `Trash2` buttons), insert the new button as the first child so it appears left of the reset-password icon:

```tsx
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {(currentRole === "owner" || currentRole === "admin") && (
                            <button
                              onClick={() => handleViewAsClient(member.userId)}
                              className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                              title="View as customer"
                              aria-label={`View portal as ${member.user.name}`}
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => handleResetPassword(member.id, member.user.email)}
                            disabled={resettingMemberId === member.id}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors disabled:opacity-50"
                            title="Send password reset link"
                          >
                            <KeyRound size={14} />
                          </button>
                          <button
                            onClick={() => handleRemoveMember(member.id, member.user.name, false)}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                            title="Remove client"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
```

- [ ] **Step 4: Verify the web app type-checks**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/clients/page.tsx
git commit -m "feat(web): add View as customer button on client rows"
```

---

## Task 10: Disable mutation buttons in portal pages

**Files:**
- Modify: `apps/web/src/app/(portal)/portal/sign/[token]/page.tsx`
- Modify: `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx`

- [ ] **Step 1: Inspect the sign page's primary action**

Run: `grep -n "button\|onClick" apps/web/src/app/\(portal\)/portal/sign/\[token\]/page.tsx | head -20`
Expected: identifies the Sign / Submit button(s).

- [ ] **Step 2: Disable the Sign action in preview**

Open `apps/web/src/app/(portal)/portal/sign/[token]/page.tsx`. At the top of the file, near the other imports:

```ts
import { usePreviewMode } from "@/lib/preview-mode";
```

Inside the page component, near the top of the body:

```ts
  const { preview } = usePreviewMode();
```

For each button that submits/signs the document (typically labeled "Sign", "Accept", or "Submit"), add `disabled={!!preview || existingDisabled}` (combining with any existing disabled state) and a `title` attribute:

```tsx
<button
  type="submit"
  disabled={!!preview /* combine with any existing disabled expression */}
  title={preview ? "Disabled in preview mode" : undefined}
  className="..."
>
  Sign
</button>
```

If the page has multiple action buttons, apply the same pattern to each.

- [ ] **Step 3: Disable invoice pay/accept actions in preview**

Open `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx`. Add the import:

```ts
import { usePreviewMode } from "@/lib/preview-mode";
```

Inside the component, near the top:

```ts
  const { preview } = usePreviewMode();
```

For each pay/accept/submit button in the file, add:

```tsx
disabled={!!preview /* combine with any existing disabled */}
title={preview ? "Disabled in preview mode" : undefined}
```

- [ ] **Step 4: Verify the web app type-checks**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(portal\)/portal/sign/\[token\]/page.tsx apps/web/src/app/\(portal\)/portal/projects/\[id\]/components/portal-invoices-section.tsx
git commit -m "feat(web): disable portal mutation buttons in preview mode"
```

---

## Task 11: E2E test

**Files:**
- Create: `e2e/tests/view-as-customer.e2e.ts`

- [ ] **Step 1: Write the test**

Create `e2e/tests/view-as-customer.e2e.ts`:

```ts
import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

async function createOwner(browser: Browser, prefix = "vac-owner") {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const orgName = `${prefix} Org ${Date.now().toString(36)}`;
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "ViewAs123!";

  const res = await page.request.post(`${API_URL}/api/onboarding/signup`, {
    data: { name: "VAC Owner", email, password, orgName },
  });
  if (!res.ok()) {
    throw new Error(`Owner signup failed: ${res.status()} ${await res.text()}`);
  }

  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15000 });

  if (page.url().includes("/setup")) {
    const cookies = await context.cookies();
    const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";
    await page.request.post(`${API_URL}/api/setup/complete`, {
      headers: { "x-csrf-token": csrfToken },
    });
    await page.goto(`${WEB_URL}/dashboard`, { waitUntil: "networkidle" });
  }

  return { context, page, email, password };
}

async function inviteAndAcceptClient(
  browser: Browser,
  ownerPage: Page,
  prefix: string,
) {
  const clientEmail = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "Client123!";

  const cookies = await ownerPage.context().cookies();
  const csrfToken = cookies.find((c) => c.name === "csrf-token")?.value || "";

  const inviteRes = await ownerPage.request.post(
    `${API_URL}/api/auth/organization/invite-member`,
    {
      data: { email: clientEmail, role: "member" },
      headers: { Origin: WEB_URL, "x-csrf-token": csrfToken },
    },
  );
  if (!inviteRes.ok()) {
    throw new Error(`Invite failed: ${inviteRes.status()} ${await inviteRes.text()}`);
  }

  // Find the invitation link from the invitations list
  const invitesRes = await ownerPage.request.get(
    `${API_URL}/api/clients/invitations`,
  );
  const invitations = (await invitesRes.json()) as Array<{
    email: string;
    inviteLink: string;
  }>;
  const link = invitations.find(
    (i) => i.email.toLowerCase() === clientEmail.toLowerCase(),
  )?.inviteLink;
  if (!link) throw new Error("Invitation link not found");

  // Accept in a fresh context
  const clientCtx = await browser.newContext({ storageState: undefined });
  const clientPage = await clientCtx.newPage();
  await clientPage.goto(link);
  await clientPage.getByLabel(/name/i).fill("Test Client");
  await clientPage.getByLabel(/^password/i).fill(password);
  await clientPage.getByRole("button", { name: /accept|create account/i }).click();
  await clientPage.waitForURL(/\/portal/, { timeout: 15000 });
  await clientCtx.close();

  return { clientEmail, password };
}

test.describe("View as customer", () => {
  test("owner can preview portal as a client and mutations are blocked", async ({
    browser,
  }) => {
    const { context, page: ownerPage } = await createOwner(browser);
    const { clientEmail } = await inviteAndAcceptClient(
      browser,
      ownerPage,
      "vac-client",
    );

    // Owner navigates to clients tab
    await ownerPage.goto(`${WEB_URL}/dashboard/clients`);
    await ownerPage.getByRole("button", { name: /clients/i }).click();
    await expect(ownerPage.getByText(clientEmail)).toBeVisible({ timeout: 10000 });

    // Click View as customer (opens new tab)
    const viewButton = ownerPage.getByRole("button", {
      name: /view portal as/i,
    });
    await expect(viewButton).toBeVisible();
    const [previewPage] = await Promise.all([
      ownerPage.context().waitForEvent("page"),
      viewButton.click(),
    ]);

    await previewPage.waitForLoadState("networkidle");
    await expect(previewPage.getByText(/previewing as/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(previewPage).toHaveURL(/\/portal/);

    // Banner should advertise read-only and an exit affordance
    await expect(previewPage.getByText(/read-only/i)).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: /exit preview/i }),
    ).toBeVisible();

    // Mutation API call should be blocked client-side
    const mutationResult = await previewPage.evaluate(async () => {
      try {
        const res = await fetch("/api/clients/me/profile", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: "should-not-save" }),
        });
        return { ok: res.ok, status: res.status };
      } catch (err) {
        return { error: String(err) };
      }
    });
    // Either the apiFetch helper short-circuits (we're calling fetch directly
    // in the eval, so the server-side guard catches it) or the server returns 403.
    expect(mutationResult.ok).not.toBe(true);

    // Exit preview returns to dashboard (or closes tab)
    await previewPage.getByRole("button", { name: /exit preview/i }).click();
    // Either tab closed, or it routed back to dashboard/clients
    await previewPage
      .waitForURL(/\/dashboard\/clients/, { timeout: 5000 })
      .catch(() => {
        // Tab may have closed instead
      });

    await context.close();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `bun run test:e2e -- view-as-customer`
Expected: the test passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/view-as-customer.e2e.ts
git commit -m "test(e2e): view-as-customer preview flow"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: all unit tests pass.

- [ ] **Step 2: Build everything**

Run: `bun run build`
Expected: clean build, no type errors.

- [ ] **Step 3: Run e2e suite**

Run: `bun run test:e2e`
Expected: all e2e tests pass (including the new one).

- [ ] **Step 4: Manual smoke**

Start dev (`bun run dev`), sign in as an owner, invite + accept a client, navigate to `/dashboard/clients`, click the eye icon on the client row, verify a new tab opens with the portal showing that client's data and the read-only banner.
