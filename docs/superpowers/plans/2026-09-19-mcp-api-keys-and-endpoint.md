# MCP Server: API Keys and Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner or admin mint an API key and connect any MCP client to `POST /api/mcp` to manage projects, clients, tasks, updates, and notes.

**Architecture:** A new `ApiKey` model plus a bearer branch in `SessionMiddleware` turns `Authorization: Bearer atr_…` into the same `req.user` / `req.organization` / `req.member` the rest of the API uses. A Nest `McpController` builds a stateless MCP server per request whose tools are thin adapters over the existing services. A settings page manages keys.

**Tech Stack:** NestJS 11, Prisma, Bun test runner, `@modelcontextprotocol/server` + `@modelcontextprotocol/node` 2.0.0, `zod` 4, Next.js 15, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-mcp-server-design.md` (sections 1, 2, 4, 5, 6, 7). OAuth login (section 3) is a separate plan: `docs/superpowers/plans/2026-09-19-mcp-oauth-login.md`.

## Global Constraints

- Branch: `feat/mcp-server`. Never commit to `main`. Never add `Co-Authored-By` or other attribution trailers to commits.
- TypeScript: explicit types on variables, parameters, and return values. No `any` in non-test code.
- Every `catch` block logs the error (Nest `Logger` in the API, `console.error` in the web app).
- TDD: write the failing test first in every task that has one.
- Unit tests (`apps/api/src/**/*.spec.ts`) do no I/O and must pass with no database. Run with `cd apps/api && bun test src/<path>`.
- Integration tests run only through `bun run test:integration` (disposable `atrium_test` database on port 5433).
- Key format: `atr_` + 32 random bytes base64url. Only the SHA-256 hex hash is stored. `keyPrefix` is the first 12 characters.
- Keys resolve only while the key's user is `owner` or `admin` of the key's organization.
- List tools use `page` (default 1) and `limit` (default 20, max 50), matching the services' pagination.
- MCP rate limit: 300 requests per minute per API key.
- The database uses `prisma db push` (no migration files). Every new table must also be added to `packages/database/rls/enable-rls.sql`.

## File Structure

```
packages/database/prisma/schema.prisma          + ApiKey model, back-relations
packages/database/rls/enable-rls.sql            + api_key
apps/api/src/common/types/authenticated-request.ts   + Actor, apiKeyId
apps/api/src/api-keys/
  api-keys.module.ts        exports ApiKeysService
  api-keys.service.ts       create / list / revoke / resolve
  api-keys.service.spec.ts
  api-keys.controller.ts    GET/POST/DELETE /api/api-keys
  api-keys.controller.spec.ts
  api-keys.dto.ts
apps/api/src/auth/session.middleware.ts         + bearer branch
apps/api/src/auth/session.middleware.spec.ts    new
apps/api/src/billing/billing.service.ts         + assertPlanLimit
apps/api/src/common/helpers/plan-limit.ts       planLimitMessage (shared rule)
apps/api/src/common/guards/plan.guard.ts        uses planLimitMessage
apps/api/src/clients/clients.service.ts         + list, findMember
apps/api/src/mcp/
  mcp.module.ts
  mcp.controller.ts         POST /api/mcp, 405 for GET/DELETE
  mcp.service.ts            buildServer(actor), handle(req, res)
  mcp.service.spec.ts
  rate-limiter.ts           sliding window
  rate-limiter.spec.ts
  tool-kit.ts               defineTool, ok, fail, runTool, paging
  tool-kit.spec.ts
  tools/workspace.tools.ts
  tools/projects.tools.ts   (+ .spec.ts)
  tools/clients.tools.ts    (+ .spec.ts)
  tools/tasks.tools.ts      (+ .spec.ts)
  tools/updates.tools.ts    (+ .spec.ts)
  tools/notes.tools.ts      (+ .spec.ts)
apps/api/test/integration/mcp.integration.spec.ts
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/api-keys-section.tsx
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connect-card.tsx
apps/web/src/app/(dashboard)/dashboard/settings/layout.tsx   + nav entry
e2e/tests/api-keys.e2e.ts
docs/mcp.md, README.md, docs/roadmap.md
```

---

### Task 1: ApiKey schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/rls/enable-rls.sql`

**Interfaces:**
- Produces: Prisma model `ApiKey` (client accessor `prisma.apiKey`) with fields `id, name, keyHash, keyPrefix, userId, organizationId, lastUsedAt, revokedAt, createdAt` and relations `user`, `organization`.

- [ ] **Step 1: Add the model**

Append after the `Invitation` model in `packages/database/prisma/schema.prisma`:

```prisma
model ApiKey {
  id             String    @id @default(cuid())
  name           String
  keyHash        String    @unique
  keyPrefix      String
  userId         String
  organizationId String
  lastUsedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@map("api_key")
}
```

In `model User`, after `timeEntries        TimeEntry[]`, add:

```prisma
  apiKeys            ApiKey[]
```

In `model Organization`, after `timeEntries    TimeEntry[]`, add:

```prisma
  apiKeys        ApiKey[]
```

- [ ] **Step 2: Add the table to RLS**

In `packages/database/rls/enable-rls.sql`, add to the ENABLE block (after the last `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` line):

```sql
ALTER TABLE "api_key"           ENABLE ROW LEVEL SECURITY;
```

and to the REVOKE block (after the `"subscription"` line):

```sql
REVOKE ALL ON "api_key"           FROM anon, authenticated;
```

- [ ] **Step 3: Validate and generate**

Run: `cd packages/database && bunx prisma validate && cd ../.. && bun run db:generate`
Expected: "The schema at prisma/schema.prisma is valid" and a successful client generation.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/rls/enable-rls.sql
git commit -m "feat(db): add ApiKey model"
```

---

### Task 2: ApiKeysService

**Files:**
- Modify: `apps/api/src/common/types/authenticated-request.ts`
- Modify: `apps/api/src/common/index.ts`
- Create: `apps/api/src/api-keys/api-keys.service.ts`
- Create: `apps/api/src/api-keys/api-keys.module.ts`
- Test: `apps/api/src/api-keys/api-keys.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.apiKey` from Task 1.
- Produces:
  - `interface Actor { user: AuthUser; organization: FullOrganization; member: OrgMember }` exported from `../common`.
  - `AuthenticatedRequest.apiKeyId?: string`.
  - `API_KEY_PREFIX = "atr_"`, `hashApiKey(token: string): string`.
  - `ApiKeysService.create(name: string, userId: string, organizationId: string): Promise<CreatedApiKey>` where `CreatedApiKey = { id: string; name: string; keyPrefix: string; key: string; createdAt: Date }`.
  - `ApiKeysService.list(organizationId: string): Promise<ApiKeySummary[]>` where `ApiKeySummary = { id; name; keyPrefix; createdAt: Date; lastUsedAt: Date | null; createdBy: string }`.
  - `ApiKeysService.revoke(id: string, organizationId: string): Promise<void>`.
  - `ApiKeysService.resolve(token: string): Promise<(Actor & { apiKeyId: string }) | null>`.
  - `ApiKeysModule` exporting `ApiKeysService`.

- [ ] **Step 1: Add shared types**

In `apps/api/src/common/types/authenticated-request.ts`, add `apiKeyId?: string;` to `AuthenticatedRequest` (after `previewMode?: boolean;`) and append:

```ts
/** The identity a request or MCP tool call acts as. */
export interface Actor {
  user: AuthUser;
  organization: FullOrganization;
  member: OrgMember;
}
```

In `apps/api/src/common/index.ts`, add `Actor,` to the same `export type { … }` block that lists `AuthenticatedRequest`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/api-keys/api-keys.service.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { ApiKeysService, hashApiKey, API_KEY_PREFIX } from "./api-keys.service";

const user = {
  id: "u1", name: "Ada", email: "ada@test.com", emailVerified: true,
  image: null, createdAt: new Date(), updatedAt: new Date(),
};
const organization = {
  id: "org1", name: "Acme", slug: "acme", logo: null,
  createdAt: new Date(), updatedAt: new Date(), metadata: null,
};

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1", name: "Agent", keyHash: "h", keyPrefix: "atr_abcdefgh",
    userId: "u1", organizationId: "org1", lastUsedAt: new Date(),
    revokedAt: null, createdAt: new Date(), user, organization,
    ...overrides,
  };
}

function buildPrisma(opts: { key?: unknown; member?: unknown } = {}) {
  return {
    apiKey: {
      create: mock((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "k1", createdAt: new Date(), ...args.data })),
      findUnique: mock(() => Promise.resolve(opts.key ?? null)),
      findFirst: mock(() => Promise.resolve(opts.key ?? null)),
      findMany: mock(() => Promise.resolve([])),
      update: mock(() => Promise.resolve({})),
    },
    member: { findFirst: mock(() => Promise.resolve(opts.member ?? null)) },
  };
}

describe("ApiKeysService", () => {
  it("create returns a prefixed key once and stores only its hash", async () => {
    const prisma = buildPrisma();
    const service = new ApiKeysService(prisma as never);

    const created = await service.create("Agent", "u1", "org1");

    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.key.length).toBe(4 + 43);
    expect(created.keyPrefix).toBe(created.key.slice(0, 12));
    const data = prisma.apiKey.create.mock.calls[0][0].data;
    expect(data.keyHash).toBe(hashApiKey(created.key));
    expect(JSON.stringify(data)).not.toContain(created.key);
  });

  it("resolve returns the actor for an owner", async () => {
    const member = { id: "m1", userId: "u1", organizationId: "org1", role: "owner", createdAt: new Date() };
    const service = new ApiKeysService(buildPrisma({ key: keyRow(), member }) as never);

    const actor = await service.resolve("atr_whatever");

    expect(actor?.apiKeyId).toBe("k1");
    expect(actor?.user.id).toBe("u1");
    expect(actor?.organization.id).toBe("org1");
    expect(actor?.member.role).toBe("owner");
  });

  it("resolve returns null for tokens without the prefix, without a lookup", async () => {
    const prisma = buildPrisma({ key: keyRow() });
    const service = new ApiKeysService(prisma as never);

    expect(await service.resolve("not-ours")).toBeNull();
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("resolve returns null for unknown, revoked, or demoted keys", async () => {
    const admin = { id: "m1", userId: "u1", organizationId: "org1", role: "admin", createdAt: new Date() };
    const client = { ...admin, role: "member" };

    expect(await new ApiKeysService(buildPrisma({ member: admin }) as never).resolve("atr_x")).toBeNull();
    expect(await new ApiKeysService(buildPrisma({ key: keyRow({ revokedAt: new Date() }), member: admin }) as never).resolve("atr_x")).toBeNull();
    expect(await new ApiKeysService(buildPrisma({ key: keyRow(), member: client }) as never).resolve("atr_x")).toBeNull();
    expect(await new ApiKeysService(buildPrisma({ key: keyRow() }) as never).resolve("atr_x")).toBeNull();
  });

  it("resolve bumps lastUsedAt only when older than a minute", async () => {
    const member = { id: "m1", userId: "u1", organizationId: "org1", role: "admin", createdAt: new Date() };
    const fresh = buildPrisma({ key: keyRow({ lastUsedAt: new Date() }), member });
    await new ApiKeysService(fresh as never).resolve("atr_x");
    expect(fresh.apiKey.update).not.toHaveBeenCalled();

    const stale = buildPrisma({ key: keyRow({ lastUsedAt: new Date(Date.now() - 120_000) }), member });
    await new ApiKeysService(stale as never).resolve("atr_x");
    expect(stale.apiKey.update).toHaveBeenCalledTimes(1);
  });

  it("revoke throws NotFound for a key in another org", async () => {
    const service = new ApiKeysService(buildPrisma() as never);
    await expect(service.revoke("k1", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test src/api-keys/api-keys.service.spec.ts`
Expected: FAIL, cannot find module `./api-keys.service`.

- [ ] **Step 4: Implement the service**

Create `apps/api/src/api-keys/api-keys.service.ts`:

```ts
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "../common";

export const API_KEY_PREFIX = "atr_";
const KEY_PREFIX_LENGTH = 12;
const LAST_USED_THROTTLE_MS = 60_000;
const KEY_ROLES: string[] = ["owner", "admin"];

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: Date;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  createdBy: string;
}

export type ResolvedApiKey = Actor & { apiKeyId: string };

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private prisma: PrismaService) {}

  async create(name: string, userId: string, organizationId: string): Promise<CreatedApiKey> {
    const key: string = API_KEY_PREFIX + randomBytes(32).toString("base64url");
    const keyPrefix: string = key.slice(0, KEY_PREFIX_LENGTH);
    const row = await this.prisma.apiKey.create({
      data: { name, keyHash: hashApiKey(key), keyPrefix, userId, organizationId },
    });
    return { id: row.id, name, keyPrefix, key, createdAt: row.createdAt };
  }

  async list(organizationId: string): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, keyPrefix: true, createdAt: true, lastUsedAt: true,
        user: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, keyPrefix: r.keyPrefix,
      createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, createdBy: r.user.name,
    }));
  }

  async revoke(id: string, organizationId: string): Promise<void> {
    const row = await this.prisma.apiKey.findFirst({
      where: { id, organizationId, revokedAt: null },
    });
    if (!row) throw new NotFoundException("API key not found");
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async resolve(token: string): Promise<ResolvedApiKey | null> {
    if (!token.startsWith(API_KEY_PREFIX)) return null;

    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(token) },
      include: { user: true, organization: true },
    });
    if (!key || key.revokedAt) return null;

    const member = await this.prisma.member.findFirst({
      where: { userId: key.userId, organizationId: key.organizationId },
    });
    if (!member || !KEY_ROLES.includes(member.role)) return null;

    this.touch(key.id, key.lastUsedAt);
    return { apiKeyId: key.id, user: key.user, organization: key.organization, member };
  }

  /** Fire-and-forget; at most one write per key per minute. */
  private touch(id: string, lastUsedAt: Date | null): void {
    if (lastUsedAt && Date.now() - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;
    this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => this.logger.error("Failed to update lastUsedAt", err));
  }
}
```

Create `apps/api/src/api-keys/api-keys.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ApiKeysService } from "./api-keys.service";

@Module({
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && bun test src/api-keys/api-keys.service.spec.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/api-keys apps/api/src/common
git commit -m "feat(api): ApiKeysService with hashed keys and role-checked resolve"
```

---

### Task 3: SessionMiddleware bearer branch

**Files:**
- Modify: `apps/api/src/auth/session.middleware.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/src/auth/session.middleware.spec.ts` (new)

**Interfaces:**
- Consumes: `ApiKeysService.resolve`, `API_KEY_PREFIX`, `hashApiKey` from Task 2.
- Produces: requests carrying `Authorization: Bearer atr_…` and no session cookie get `req.user`, `req.organization`, `req.member`, a synthetic `req.session`, and `req.apiKeyId`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/session.middleware.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { SessionMiddleware } from "./session.middleware";

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

function req(headers: Record<string, string>, cookies: Record<string, string> = {}): Request {
  return { headers, cookies, originalUrl: "/api/projects" } as unknown as Request;
}

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/auth/session.middleware.spec.ts`
Expected: FAIL. The first test fails on `r.user` being undefined (the constructor ignores the second argument today).

- [ ] **Step 3: Implement the branch**

In `apps/api/src/auth/session.middleware.ts`:

Add imports:

```ts
import { ApiKeysService, API_KEY_PREFIX, hashApiKey } from "../api-keys/api-keys.service";
```

Add `apiKeyId?: string;` to the `CachedSession` interface.

Change the constructor to:

```ts
  constructor(
    private authService: AuthService,
    private apiKeys: ApiKeysService,
  ) {}
```

Add two private methods after `extractSessionToken`:

```ts
  private extractApiKey(req: Request): string | undefined {
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return undefined;
    const token: string = header.slice(7).trim();
    return token.startsWith(API_KEY_PREFIX) ? token : undefined;
  }

  /** Resolves an API key into the same request fields a cookie session sets. */
  private async applyApiKey(
    authReq: Partial<AuthenticatedRequest>,
    apiKey: string,
  ): Promise<void> {
    // Cache under the hash so raw keys are not held in memory.
    const cacheKey: string = hashApiKey(apiKey);
    let entry: CachedSession | undefined = this.cache.get(cacheKey);
    if (entry && entry.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      entry = undefined;
    }

    if (!entry) {
      const resolved = await this.apiKeys.resolve(apiKey);
      if (!resolved) return;
      const now: Date = new Date();
      entry = {
        user: resolved.user,
        organization: resolved.organization,
        member: resolved.member,
        apiKeyId: resolved.apiKeyId,
        session: {
          id: `apikey:${resolved.apiKeyId}`,
          token: "",
          userId: resolved.user.id,
          activeOrganizationId: resolved.organization.id,
          expiresAt: new Date(now.getTime() + SESSION_CACHE_TTL),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: null,
        },
        expiresAt: now.getTime() + SESSION_CACHE_TTL,
      };
      this.cache.set(cacheKey, entry);
    }

    authReq.user = entry.user;
    authReq.session = entry.session;
    authReq.organization = entry.organization;
    authReq.member = entry.member;
    authReq.apiKeyId = entry.apiKeyId;
  }
```

Widen the `authReq` type in `use()` so it includes `apiKeyId`:

```ts
    const authReq = req as Partial<
      Pick<AuthenticatedRequest, "user" | "session" | "organization" | "member" | "apiKeyId">
    > &
      Request;
```

Inside `use()`, directly after the line `const isAuthRoute = req.originalUrl.startsWith("/api/auth/");`, add:

```ts
      // API keys apply only when there is no browser session, so the
      // cookie + CSRF model is never mixed with bearer auth.
      if (!token) {
        const apiKey: string | undefined = this.extractApiKey(req);
        if (apiKey) {
          await this.applyApiKey(authReq, apiKey);
          return next();
        }
      }
```

Replace the bare `} catch {` at the end of `use()` with a logging catch (global rule: every catch logs). Add `Logger` to the `@nestjs/common` import and a field `private readonly logger = new Logger(SessionMiddleware.name);`, then:

```ts
    } catch (err) {
      // Session resolution failed — continue without auth.
      // The AuthGuard will reject unauthenticated requests.
      this.logger.warn(`Session resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
```

In `apps/api/src/auth/auth.module.ts`, import `ApiKeysModule`:

```ts
import { ApiKeysModule } from "../api-keys/api-keys.module";
// …
  imports: [MailModule, BillingModule, ApiKeysModule],
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && bun test src/auth`
Expected: all pass, including the 5 new tests.

- [ ] **Step 5: Type-check**

Run: `cd apps/api && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): authenticate requests with API keys in SessionMiddleware"
```

---

### Task 4: API keys REST endpoints

**Files:**
- Create: `apps/api/src/api-keys/api-keys.dto.ts`
- Create: `apps/api/src/api-keys/api-keys.controller.ts`
- Modify: `apps/api/src/api-keys/api-keys.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/api-keys/api-keys.controller.spec.ts`

**Interfaces:**
- Consumes: `ApiKeysService` (Task 2), `req.apiKeyId` (Task 3).
- Produces: `GET /api/api-keys` → `ApiKeySummary[]`; `POST /api/api-keys` body `{ name }` → `CreatedApiKey`; `DELETE /api/api-keys/:id` → 200 empty.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/api-keys/api-keys.controller.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { ApiKeysController } from "./api-keys.controller";
import type { AuthenticatedRequest } from "../common";

function build() {
  const service = {
    create: mock(() => Promise.resolve({ id: "k1", name: "Agent", keyPrefix: "atr_abcdefgh", key: "atr_full", createdAt: new Date() })),
    list: mock(() => Promise.resolve([])),
    revoke: mock(() => Promise.resolve()),
  };
  return { controller: new ApiKeysController(service as never), service };
}

describe("ApiKeysController", () => {
  it("creates a key for the current user and org", async () => {
    const { controller, service } = build();
    const result = await controller.create({ name: "Agent" }, {} as AuthenticatedRequest, "org1", "u1");
    expect(result.key).toBe("atr_full");
    expect(service.create).toHaveBeenCalledWith("Agent", "u1", "org1");
  });

  it("refuses to create a key when the request itself used an API key", async () => {
    const { controller, service } = build();
    const req = { apiKeyId: "k0" } as AuthenticatedRequest;
    await expect(controller.create({ name: "Agent" }, req, "org1", "u1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("lists and revokes within the current org", async () => {
    const { controller, service } = build();
    await controller.list("org1");
    await controller.revoke("k1", "org1");
    expect(service.list).toHaveBeenCalledWith("org1");
    expect(service.revoke).toHaveBeenCalledWith("k1", "org1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/api-keys/api-keys.controller.spec.ts`
Expected: FAIL, cannot find module `./api-keys.controller`.

- [ ] **Step 3: Implement**

Create `apps/api/src/api-keys/api-keys.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;
}
```

Create `apps/api/src/api-keys/api-keys.controller.ts`:

```ts
import {
  Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import type { AuthenticatedRequest } from "../common";
import { ApiKeysService } from "./api-keys.service";
import type { ApiKeySummary, CreatedApiKey } from "./api-keys.service";
import { CreateApiKeyDto } from "./api-keys.dto";

@Controller("api-keys")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class ApiKeysController {
  constructor(private apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentOrg("id") orgId: string): Promise<ApiKeySummary[]> {
    return this.apiKeys.list(orgId);
  }

  @Post()
  create(
    @Body() dto: CreateApiKeyDto,
    @Req() req: AuthenticatedRequest,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ): Promise<CreatedApiKey> {
    // A leaked key must not be able to mint more keys.
    if (req.apiKeyId) {
      throw new ForbiddenException("API keys cannot create API keys. Sign in to the dashboard.");
    }
    return this.apiKeys.create(dto.name.trim(), userId, orgId);
  }

  @Delete(":id")
  revoke(@Param("id") id: string, @CurrentOrg("id") orgId: string): Promise<void> {
    return this.apiKeys.revoke(id, orgId);
  }
}
```

In `apps/api/src/api-keys/api-keys.module.ts` add the controller:

```ts
import { Module } from "@nestjs/common";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
```

In `apps/api/src/app.module.ts`, add `import { ApiKeysModule } from "./api-keys/api-keys.module";` and add `ApiKeysModule,` after `CalendarModule,` in `imports`.

- [ ] **Step 4: Run the tests and type-check**

Run: `cd apps/api && bun test src/api-keys && bunx tsc --noEmit -p tsconfig.json`
Expected: 9 pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/api-keys apps/api/src/app.module.ts
git commit -m "feat(api): API key management endpoints"
```

---

### Task 5: MCP dependencies and tool kit

**Files:**
- Modify: `apps/api/package.json` (via `bun add`)
- Create: `apps/api/src/mcp/tool-kit.ts`
- Test: `apps/api/src/mcp/tool-kit.spec.ts`

**Interfaces:**
- Consumes: `Actor` from `../common` (Task 2).
- Produces:
  - `interface McpTool { name: string; description: string; inputSchema: z.ZodType; ownerOnly: boolean; handler: (input: unknown, actor: Actor) => Promise<unknown> }`
  - `defineTool<S extends z.ZodType>(def: { name: string; description: string; inputSchema: S; ownerOnly?: boolean; handler: (input: z.infer<S>, actor: Actor) => Promise<unknown> }): McpTool`
  - `interface ToolResult { content: { type: "text"; text: string }[]; isError?: boolean }`
  - `ok(value: unknown): ToolResult`, `fail(err: unknown): ToolResult`
  - `runTool(tool: McpTool, input: unknown, actor: Actor): Promise<ToolResult>`
  - `paging`: `{ page: z.ZodDefault<z.ZodNumber>; limit: z.ZodDefault<z.ZodNumber> }` to spread into list schemas.

- [ ] **Step 1: Install dependencies**

Run: `cd apps/api && bun add @modelcontextprotocol/server@2.0.0 @modelcontextprotocol/node@2.0.0 zod@^4.2.0 && bun add -d @modelcontextprotocol/client@2.0.0`
Expected: `package.json` gains the four entries; `bun.lock` updates.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/mcp/tool-kit.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import * as z from "zod/v4";
import { defineTool, runTool, paging } from "./tool-kit";
import type { Actor } from "../common";

function actor(role: string): Actor {
  return {
    user: { id: "u1" }, organization: { id: "org1" }, member: { role },
  } as unknown as Actor;
}

describe("tool-kit", () => {
  it("wraps a successful result as JSON text", async () => {
    const tool = defineTool({
      name: "echo", description: "d", inputSchema: z.object({ a: z.string() }),
      handler: async (input, act) => ({ a: input.a, org: act.organization.id }),
    });
    const result = await runTool(tool, { a: "x" }, actor("admin"));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ a: "x", org: "org1" });
  });

  it("maps HttpExceptions to isError with the original message", async () => {
    const tool = defineTool({
      name: "boom", description: "d", inputSchema: z.object({}),
      handler: async () => { throw new NotFoundException("Project not found"); },
    });
    const result = await runTool(tool, {}, actor("admin"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Project not found");
  });

  it("hides unknown error details", async () => {
    const tool = defineTool({
      name: "boom", description: "d", inputSchema: z.object({}),
      handler: async () => { throw new Error("connection string leaked"); },
    });
    const result = await runTool(tool, {}, actor("admin"));
    expect(result.content[0].text).toBe("Internal error");
  });

  it("blocks ownerOnly tools for admins and allows owners", async () => {
    const tool = defineTool({
      name: "danger", description: "d", inputSchema: z.object({}), ownerOnly: true,
      handler: async () => "done",
    });
    expect((await runTool(tool, {}, actor("admin"))).isError).toBe(true);
    expect((await runTool(tool, {}, actor("owner"))).isError).toBeUndefined();
  });

  it("paging defaults to page 1, limit 20 and caps limit at 50", () => {
    const schema = z.object({ ...paging });
    expect(schema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(schema.safeParse({ limit: 51 }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test src/mcp/tool-kit.spec.ts`
Expected: FAIL, cannot find module `./tool-kit`.

- [ ] **Step 4: Implement**

Create `apps/api/src/mcp/tool-kit.ts`:

```ts
import { ForbiddenException, HttpException, Logger } from "@nestjs/common";
import * as z from "zod/v4";
import type { Actor } from "../common";

const logger = new Logger("McpTools");

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  ownerOnly: boolean;
  handler: (input: unknown, actor: Actor) => Promise<unknown>;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * Declares a tool with a typed handler. The returned value is type-erased so
 * tools with different schemas can live in one array; the MCP SDK has already
 * validated the input against `inputSchema` before the handler runs.
 */
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  inputSchema: S;
  ownerOnly?: boolean;
  handler: (input: z.infer<S>, actor: Actor) => Promise<unknown>;
}): McpTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    ownerOnly: def.ownerOnly ?? false,
    handler: (input: unknown, actor: Actor): Promise<unknown> =>
      def.handler(input as z.infer<S>, actor),
  };
}

export function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value ?? { ok: true }) }] };
}

export function fail(err: unknown): ToolResult {
  let text: string = "Internal error";
  if (err instanceof HttpException) {
    const response: string | object = err.getResponse();
    const message: unknown =
      typeof response === "string" ? response : (response as { message?: unknown }).message;
    text = Array.isArray(message) ? message.join("; ") : String(message ?? err.message);
  } else {
    logger.error("Unhandled tool error", err instanceof Error ? err.stack : String(err));
  }
  return { isError: true, content: [{ type: "text", text }] };
}

export async function runTool(tool: McpTool, input: unknown, actor: Actor): Promise<ToolResult> {
  try {
    if (tool.ownerOnly && actor.member.role !== "owner") {
      throw new ForbiddenException("Only the workspace owner can do this.");
    }
    return ok(await tool.handler(input, actor));
  } catch (err) {
    return fail(err);
  }
}

/** Spread into list-tool schemas. Matches the services' page/limit pagination. */
export const paging = {
  page: z.number().int().min(1).default(1).describe("Page number, starting at 1"),
  limit: z.number().int().min(1).max(50).default(20).describe("Results per page (max 50)"),
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && bun test src/mcp/tool-kit.spec.ts`
Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json bun.lock apps/api/src/mcp
git commit -m "feat(api): MCP SDK dependencies and tool kit"
```

---

### Task 6: Service groundwork (clients list, plan limit, module exports)

**Files:**
- Modify: `apps/api/src/clients/clients.service.ts`
- Modify: `apps/api/src/clients/clients.controller.ts:41-79`
- Modify: `apps/api/src/billing/billing.service.ts`
- Create: `apps/api/src/common/helpers/plan-limit.ts`
- Modify: `apps/api/src/common/guards/plan.guard.ts`
- Modify: `apps/api/src/clients/clients.module.ts`, `tasks/tasks.module.ts`, `updates/updates.module.ts`, `notes/notes.module.ts`
- Test: `apps/api/src/clients/clients.service.list.spec.ts`, `apps/api/src/billing/billing.service.plan-limit.spec.ts`

**Interfaces:**
- Produces:
  - `ClientsService.list(orgId: string, page?: number, limit?: number, search?: string)` → paginated members with `user`, `labels`, `profile`.
  - `ClientsService.findMember(userId: string, orgId: string)` → member with `user`, or throws `NotFoundException("Client not found")`.
  - `BillingService.assertPlanLimit(orgId: string, resource: PlanLimitResource): Promise<void>` throwing the same `ForbiddenException` message `PlanGuard` throws today.
  - `ClientsModule`, `TasksModule`, `UpdatesModule`, `NotesModule` export their services.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/clients/clients.service.list.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { ClientsService } from "./clients.service";

function buildPrisma(members: unknown[], total: number) {
  return {
    member: {
      findMany: mock(() => Promise.resolve(members)),
      count: mock(() => Promise.resolve(total)),
      findFirst: mock(() => Promise.resolve(members[0] ?? null)),
    },
    clientProfile: { findMany: mock(() => Promise.resolve([{ userId: "u2", company: "Globex" }])) },
  };
}

describe("ClientsService.list", () => {
  it("returns members enriched with profiles, scoped to the org", async () => {
    const prisma = buildPrisma([{ id: "m2", userId: "u2", role: "member" }], 1);
    const service = new ClientsService(prisma as never, {} as never);

    const result = await service.list("org1", 1, 20);

    expect(result.data[0].profile).toEqual({ userId: "u2", company: "Globex" });
    expect(result.meta.total).toBe(1);
    expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
  });

  it("filters by name or email when search is given", async () => {
    const prisma = buildPrisma([], 0);
    await new ClientsService(prisma as never, {} as never).list("org1", 1, 20, "glo");
    expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      user: { OR: [
        { name: { contains: "glo", mode: "insensitive" } },
        { email: { contains: "glo", mode: "insensitive" } },
      ] },
    });
  });

  it("findMember throws NotFound when the user is not in the org", async () => {
    const service = new ClientsService(buildPrisma([], 0) as never, {} as never);
    await expect(service.findMember("nope", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

Create `apps/api/src/billing/billing.service.plan-limit.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { BillingService } from "./billing.service";

function build(billingEnabled: string, projects: number, maxProjects: number) {
  const config = { get: (_k: string, fallback?: string) => billingEnabled ?? fallback };
  const service = new BillingService({} as never, {} as never, config as never);
  service.getSubscription = mock(() => Promise.resolve({ plan: { name: "Free", maxProjects, maxStorageMb: -1, maxMembers: -1, maxClients: -1 } })) as never;
  service.getUsage = mock(() => Promise.resolve({ projects, storageMb: 0, members: 0, clients: 0 })) as never;
  return service;
}

describe("BillingService.assertPlanLimit", () => {
  it("passes when billing is disabled", async () => {
    await expect(build("false", 99, 1).assertPlanLimit("org1", "projects")).resolves.toBeUndefined();
  });

  it("passes under the limit and for unlimited (-1)", async () => {
    await expect(build("true", 1, 3).assertPlanLimit("org1", "projects")).resolves.toBeUndefined();
    await expect(build("true", 99, -1).assertPlanLimit("org1", "projects")).resolves.toBeUndefined();
  });

  it("throws Forbidden with the upgrade message at the limit", async () => {
    await expect(build("true", 3, 3).assertPlanLimit("org1", "projects")).rejects.toThrow(
      "You've reached the projects limit (3/3) on your Free plan. Please upgrade to continue.",
    );
    await expect(build("true", 3, 3).assertPlanLimit("org1", "projects")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/clients/clients.service.list.spec.ts src/billing/billing.service.plan-limit.spec.ts`
Expected: FAIL, `service.list is not a function` and `assertPlanLimit is not a function`.

- [ ] **Step 3: Implement `ClientsService.list` and `findMember`**

In `apps/api/src/clients/clients.service.ts`, add to the imports `import { paginatedResponse } from "../common";` and add these methods to the class:

```ts
  async list(orgId: string, page = 1, limit = 20, search?: string) {
    const where = {
      organizationId: orgId,
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          hourlyRateCents: true,
          user: { select: { id: true, name: true, email: true } },
          labels: { select: { label: { select: { id: true, name: true, color: true } } } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.member.count({ where }),
    ]);

    const userIds: string[] = data.map((m) => m.userId);
    const profiles = await this.prisma.clientProfile.findMany({
      where: { userId: { in: userIds }, organizationId: orgId },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const enriched = data.map((m) => ({ ...m, profile: profileMap.get(m.userId) || null }));
    return paginatedResponse(enriched, total, page, limit);
  }

  async findMember(userId: string, orgId: string) {
    const member = await this.prisma.member.findFirst({
      where: { userId, organizationId: orgId },
      select: {
        id: true, userId: true, role: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!member) throw new NotFoundException("Client not found");
    return member;
  }
```

In `apps/api/src/clients/clients.controller.ts`, replace the whole body of `list()` (from `const { page = 1, limit = 20 } = query;` through `return paginatedResponse(enriched, total, page, limit);`) with:

```ts
    return this.clientsService.list(orgId, query.page, query.limit);
```

Remove `paginatedResponse` from the controller's `../common` import if it is no longer used there (check with `grep -n paginatedResponse apps/api/src/clients/clients.controller.ts`).

- [ ] **Step 4: Share the limit rule between the guard and `BillingService.assertPlanLimit`**

The existing `plan.guard.spec.ts` constructs `PlanGuard(reflector, config, billingService)` with a
plain-object billing mock that has only `getSubscription` and `getUsage`. Keep that contract: the
guard keeps fetching; only the comparison moves into a pure helper both callers use.

Create `apps/api/src/common/helpers/plan-limit.ts`:

```ts
import type { PlanLimitResource } from "../decorators/plan-limit.decorator";

export interface PlanLimits {
  name: string;
  maxProjects: number;
  maxStorageMb: number;
  maxMembers: number;
  maxClients: number;
}

export interface PlanUsage {
  projects: number;
  storageMb: number;
  members: number;
  clients: number;
}

/** Returns the upgrade message when the org is at its limit, or null. -1 means unlimited. */
export function planLimitMessage(
  plan: PlanLimits,
  usage: PlanUsage,
  resource: PlanLimitResource,
): string | null {
  const table: Record<PlanLimitResource, { limit: number; current: number; label: string }> = {
    projects: { limit: plan.maxProjects, current: usage.projects, label: "projects" },
    storage: { limit: plan.maxStorageMb, current: usage.storageMb, label: "storage (MB)" },
    members: { limit: plan.maxMembers, current: usage.members, label: "team members" },
    clients: { limit: plan.maxClients, current: usage.clients, label: "clients" },
  };
  const { limit, current, label } = table[resource];
  if (limit === -1 || current < limit) return null;
  return `You've reached the ${label} limit (${current}/${limit}) on your ${plan.name} plan. Please upgrade to continue.`;
}
```

In `apps/api/src/common/guards/plan.guard.ts`, replace everything from `const plan = subscription.plan;`
through the closing brace of the `if (current >= limit) { … }` block (the `let limit/current/label`
declarations, the `switch`, the `-1` check, and the throw) with:

```ts
    const message: string | null = planLimitMessage(subscription.plan, usage, resource);
    if (message) throw new ForbiddenException(message);
```

and add `import { planLimitMessage } from "../helpers/plan-limit";`. The final `return true;` stays.

In `apps/api/src/billing/billing.service.ts`, add `ForbiddenException` to the `@nestjs/common` import,
add `import { planLimitMessage } from "../common/helpers/plan-limit";` and
`import type { PlanLimitResource } from "../common/decorators/plan-limit.decorator";`, then add:

```ts
  /** Same rule PlanGuard enforces on REST routes, for callers that are not HTTP handlers (MCP tools). */
  async assertPlanLimit(orgId: string, resource: PlanLimitResource): Promise<void> {
    if (this.config.get("BILLING_ENABLED", "false") !== "true") return;

    const [subscription, usage] = await Promise.all([
      this.getSubscription(orgId),
      this.getUsage(orgId),
    ]);
    if (!subscription) return;

    const message: string | null = planLimitMessage(subscription.plan, usage, resource);
    if (message) throw new ForbiddenException(message);
  }
```

- [ ] **Step 5: Export services from their modules**

Add `exports: [ClientsService],` to `apps/api/src/clients/clients.module.ts`, `exports: [TasksService],` to `tasks/tasks.module.ts`, `exports: [UpdatesService],` to `updates/updates.module.ts`, and `exports: [NotesService],` to `notes/notes.module.ts` (inside each `@Module({...})`). `ProjectsModule` and `BillingModule` already export theirs.

- [ ] **Step 6: Run the full unit suite and type-check**

Run: `cd apps/api && bun test src && bunx tsc --noEmit -p tsconfig.json`
Expected: all pass (the refactors must not break existing clients or plan guard specs), no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "refactor(api): extract client list and plan limit check into services"
```

---

### Task 7: Workspace and project tools

**Files:**
- Create: `apps/api/src/mcp/tools/workspace.tools.ts`
- Create: `apps/api/src/mcp/tools/projects.tools.ts`
- Test: `apps/api/src/mcp/tools/projects.tools.spec.ts`

**Interfaces:**
- Consumes: `defineTool`, `paging`, `McpTool` (Task 5); `ProjectsService`; `BillingService.assertPlanLimit` (Task 6).
- Produces: `workspaceTools(): McpTool[]` and `projectTools(deps: { projects: ProjectsService; billing: BillingService }): McpTool[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/mcp/tools/projects.tools.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { projectTools } from "./projects.tools";
import { workspaceTools } from "./workspace.tools";
import { runTool } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { Actor } from "../../common";

const owner = {
  user: { id: "u1", name: "Ada", email: "a@t.co" },
  organization: { id: "org1", name: "Acme", slug: "acme" },
  member: { role: "owner" },
} as unknown as Actor;
const admin = { ...owner, member: { role: "admin" } } as unknown as Actor;

function build() {
  const projects = {
    findAll: mock(() => Promise.resolve({ data: [], meta: {} })),
    findOne: mock(() => Promise.resolve({ id: "p1" })),
    create: mock(() => Promise.resolve({ id: "p1", name: "Site" })),
    update: mock(() => Promise.resolve({ id: "p1" })),
    archive: mock(() => Promise.resolve({ id: "p1" })),
    unarchive: mock(() => Promise.resolve({ id: "p1" })),
    remove: mock(() => Promise.resolve()),
    getStatuses: mock(() => Promise.resolve([])),
  };
  const billing = { assertPlanLimit: mock(() => Promise.resolve()) };
  const tools = projectTools({ projects: projects as never, billing: billing as never });
  const get = (name: string): McpTool => tools.find((t) => t.name === name)!;
  return { projects, billing, tools, get };
}

describe("project tools", () => {
  it("exposes the expected tool names", () => {
    expect(build().tools.map((t) => t.name).sort()).toEqual([
      "archive_project", "create_project", "delete_project", "get_project",
      "list_project_statuses", "list_projects", "update_project",
    ]);
  });

  it("list_projects passes filters and the actor's org", async () => {
    const { projects, get } = build();
    const input = get("list_projects").inputSchema.parse({ search: "site", archived: true });
    await runTool(get("list_projects"), input, admin);
    expect(projects.findAll).toHaveBeenCalledWith("org1", {
      page: 1, limit: 20, search: "site", status: undefined, archived: "true",
    });
  });

  it("create_project checks the plan limit, then creates in the actor's org", async () => {
    const { projects, billing, get } = build();
    const result = await runTool(get("create_project"), { name: "Site" }, admin);
    expect(billing.assertPlanLimit).toHaveBeenCalledWith("org1", "projects");
    expect(projects.create).toHaveBeenCalledWith({ name: "Site" }, "org1");
    expect(JSON.parse(result.content[0].text).id).toBe("p1");
  });

  it("update_project separates the id from the patch", async () => {
    const { projects, get } = build();
    await runTool(get("update_project"), { projectId: "p1", status: "done" }, admin);
    expect(projects.update).toHaveBeenCalledWith("p1", { status: "done" }, "org1");
  });

  it("archive_project routes to archive or unarchive", async () => {
    const { projects, get } = build();
    await runTool(get("archive_project"), { projectId: "p1", archived: true }, admin);
    await runTool(get("archive_project"), { projectId: "p1", archived: false }, admin);
    expect(projects.archive).toHaveBeenCalledWith("p1", "org1");
    expect(projects.unarchive).toHaveBeenCalledWith("p1", "org1");
  });

  it("delete_project is owner-only", async () => {
    const { projects, get } = build();
    expect((await runTool(get("delete_project"), { projectId: "p1" }, admin)).isError).toBe(true);
    expect(projects.remove).not.toHaveBeenCalled();
    await runTool(get("delete_project"), { projectId: "p1" }, owner);
    expect(projects.remove).toHaveBeenCalledWith("p1", "org1");
  });

  it("surfaces NotFound from the service", async () => {
    const { projects, get } = build();
    projects.findOne.mockImplementation(() => Promise.reject(new NotFoundException("Project not found")));
    const result = await runTool(get("get_project"), { projectId: "zzz" }, admin);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Project not found");
  });

  it("create_project rejects names over 255 chars", () => {
    expect(build().get("create_project").inputSchema.safeParse({ name: "x".repeat(256) }).success).toBe(false);
  });
});

describe("workspace tools", () => {
  it("get_workspace describes the org and acting user", async () => {
    const tool = workspaceTools()[0];
    const result = await runTool(tool, {}, owner);
    expect(JSON.parse(result.content[0].text)).toEqual({
      workspace: { id: "org1", name: "Acme", slug: "acme" },
      actingAs: { id: "u1", name: "Ada", email: "a@t.co", role: "owner" },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/mcp/tools/projects.tools.spec.ts`
Expected: FAIL, cannot find module `./projects.tools`.

- [ ] **Step 3: Implement**

Create `apps/api/src/mcp/tools/workspace.tools.ts`:

```ts
import * as z from "zod/v4";
import { defineTool } from "../tool-kit";
import type { McpTool } from "../tool-kit";

export function workspaceTools(): McpTool[] {
  return [
    defineTool({
      name: "get_workspace",
      description:
        "Returns the Atrium workspace this connection is bound to and the user you are acting as. Call this first to orient yourself.",
      inputSchema: z.object({}),
      handler: async (_input, actor) => ({
        workspace: {
          id: actor.organization.id,
          name: actor.organization.name,
          slug: actor.organization.slug,
        },
        actingAs: {
          id: actor.user.id,
          name: actor.user.name,
          email: actor.user.email,
          role: actor.member.role,
        },
      }),
    }),
  ];
}
```

Create `apps/api/src/mcp/tools/projects.tools.ts`:

```ts
import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ProjectsService } from "../../projects/projects.service";
import type { BillingService } from "../../billing/billing.service";

const isoDate = z.string().describe("ISO 8601 date, e.g. 2026-10-01");

const projectFields = {
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: z.string().max(100).optional().describe("A status slug from list_project_statuses"),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  clientUserIds: z.array(z.string()).optional().describe("User IDs from list_clients to give portal access"),
};

export function projectTools(deps: {
  projects: ProjectsService;
  billing: BillingService;
}): McpTool[] {
  const { projects, billing } = deps;
  return [
    defineTool({
      name: "list_projects",
      description:
        "Lists projects in the workspace, newest first. Archived projects are hidden unless archived is true.",
      inputSchema: z.object({
        search: z.string().max(200).optional().describe("Matches project names"),
        status: z.string().max(100).optional().describe("A status slug from list_project_statuses"),
        archived: z.boolean().default(false),
        ...paging,
      }),
      handler: async (input, actor) =>
        projects.findAll(actor.organization.id, {
          page: input.page,
          limit: input.limit,
          search: input.search,
          status: input.status,
          archived: input.archived ? "true" : undefined,
        }),
    }),
    defineTool({
      name: "get_project",
      description: "Returns one project with its clients and details.",
      inputSchema: z.object({ projectId: z.string() }),
      handler: async (input, actor) => projects.findOne(input.projectId, actor.organization.id),
    }),
    defineTool({
      name: "create_project",
      description: "Creates a project. Only name is required.",
      inputSchema: z.object(projectFields),
      handler: async (input, actor) => {
        await billing.assertPlanLimit(actor.organization.id, "projects");
        return projects.create(input, actor.organization.id);
      },
    }),
    defineTool({
      name: "update_project",
      description: "Updates fields on a project. Only the fields you pass are changed.",
      inputSchema: z.object({
        projectId: z.string(),
        ...projectFields,
        name: projectFields.name.optional(),
      }),
      handler: async (input, actor) => {
        const { projectId, ...patch } = input;
        return projects.update(projectId, patch, actor.organization.id);
      },
    }),
    defineTool({
      name: "archive_project",
      description: "Archives a project (archived: true) or restores it (archived: false). Nothing is deleted.",
      inputSchema: z.object({ projectId: z.string(), archived: z.boolean() }),
      handler: async (input, actor) =>
        input.archived
          ? projects.archive(input.projectId, actor.organization.id)
          : projects.unarchive(input.projectId, actor.organization.id),
    }),
    defineTool({
      name: "list_project_statuses",
      description: "Lists the workspace's project statuses. Use a status slug when creating or filtering projects.",
      inputSchema: z.object({}),
      handler: async (_input, actor) => projects.getStatuses(actor.organization.id),
    }),
    defineTool({
      name: "delete_project",
      description:
        "Permanently deletes a project and everything in it. Owner only. Prefer archive_project unless the user explicitly asks to delete.",
      inputSchema: z.object({ projectId: z.string() }),
      ownerOnly: true,
      handler: async (input, actor) => projects.remove(input.projectId, actor.organization.id),
    }),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/mcp/tools/projects.tools.spec.ts`
Expected: 9 pass.

- [ ] **Step 5: Type-check**

Run: `cd apps/api && bunx tsc --noEmit -p tsconfig.json`
Expected: no errors. If `projects.create(input, …)` reports that the zod output is not assignable to `CreateProjectDto`, the shapes differ: fix the zod field, not the DTO.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/mcp/tools
git commit -m "feat(api): MCP workspace and project tools"
```

---

### Task 8: Client and task tools

**Files:**
- Create: `apps/api/src/mcp/tools/clients.tools.ts`
- Create: `apps/api/src/mcp/tools/tasks.tools.ts`
- Test: `apps/api/src/mcp/tools/clients.tools.spec.ts`, `apps/api/src/mcp/tools/tasks.tools.spec.ts`

**Interfaces:**
- Consumes: `ClientsService.list`, `findMember`, `getProfile` (Task 6); `ProjectsService.findByClient(clientUserId, organizationId, { page, limit, search })`; `TasksService.create(dto, projectId, orgId)`, `findByProject(projectId, orgId, page, limit, status)`, `update(id, dto, orgId)`, `remove(id, orgId)`.
- Produces: `clientTools(deps: { clients: ClientsService; projects: ProjectsService }): McpTool[]`, `taskTools(deps: { tasks: TasksService }): McpTool[]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/mcp/tools/clients.tools.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { clientTools } from "./clients.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const clients = {
    list: mock(() => Promise.resolve({ data: [], meta: {} })),
    findMember: mock(() => Promise.resolve({ userId: "u2", role: "member", user: { name: "Bob" } })),
    getProfile: mock(() => Promise.resolve({ company: "Globex" })),
  };
  const projects = { findByClient: mock(() => Promise.resolve({ data: [{ id: "p1" }], meta: {} })) };
  const tools = clientTools({ clients: clients as never, projects: projects as never });
  return { clients, projects, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("client tools", () => {
  it("list_clients forwards paging and search", async () => {
    const { clients, get } = build();
    const input = get("list_clients").inputSchema.parse({ search: "glo" });
    await runTool(get("list_clients"), input, admin);
    expect(clients.list).toHaveBeenCalledWith("org1", 1, 20, "glo");
  });

  it("get_client combines member, profile, and projects", async () => {
    const { clients, projects, get } = build();
    const result = await runTool(get("get_client"), { clientUserId: "u2" }, admin);
    expect(clients.findMember).toHaveBeenCalledWith("u2", "org1");
    expect(projects.findByClient).toHaveBeenCalledWith("u2", "org1", { page: 1, limit: 50 });
    expect(JSON.parse(result.content[0].text)).toEqual({
      member: { userId: "u2", role: "member", user: { name: "Bob" } },
      profile: { company: "Globex" },
      projects: [{ id: "p1" }],
    });
  });
});
```

Create `apps/api/src/mcp/tools/tasks.tools.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { taskTools } from "./tasks.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const tasks = {
    findByProject: mock(() => Promise.resolve({ data: [], meta: {} })),
    create: mock(() => Promise.resolve({ id: "t1" })),
    update: mock(() => Promise.resolve({ id: "t1" })),
    remove: mock(() => Promise.resolve()),
  };
  const tools = taskTools({ tasks: tasks as never });
  return { tasks, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("task tools", () => {
  it("list_tasks defaults to active tasks", async () => {
    const { tasks, get } = build();
    const input = get("list_tasks").inputSchema.parse({ projectId: "p1" });
    await runTool(get("list_tasks"), input, admin);
    expect(tasks.findByProject).toHaveBeenCalledWith("p1", "org1", 1, 20, "active");
  });

  it("create_task separates projectId from the task fields", async () => {
    const { tasks, get } = build();
    await runTool(get("create_task"), { projectId: "p1", title: "Ship", dueDate: "2026-10-01" }, admin);
    expect(tasks.create).toHaveBeenCalledWith({ title: "Ship", dueDate: "2026-10-01" }, "p1", "org1");
  });

  it("update_task passes null to clear dueDate and assignee", async () => {
    const { tasks, get } = build();
    const input = get("update_task").inputSchema.parse({ taskId: "t1", dueDate: null, assigneeId: null, status: "done" });
    await runTool(get("update_task"), input, admin);
    expect(tasks.update).toHaveBeenCalledWith("t1", { dueDate: null, assigneeId: null, status: "done" }, "org1");
  });

  it("update_task rejects unknown statuses", () => {
    expect(build().get("update_task").inputSchema.safeParse({ taskId: "t1", status: "blocked" }).success).toBe(false);
  });

  it("delete_task removes within the actor's org", async () => {
    const { tasks, get } = build();
    await runTool(get("delete_task"), { taskId: "t1" }, admin);
    expect(tasks.remove).toHaveBeenCalledWith("t1", "org1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/mcp/tools/clients.tools.spec.ts src/mcp/tools/tasks.tools.spec.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/mcp/tools/clients.tools.ts`:

```ts
import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ClientsService } from "../../clients/clients.service";
import type { ProjectsService } from "../../projects/projects.service";

export function clientTools(deps: {
  clients: ClientsService;
  projects: ProjectsService;
}): McpTool[] {
  const { clients, projects } = deps;
  return [
    defineTool({
      name: "list_clients",
      description:
        "Lists everyone in the workspace: team (role owner or admin) and clients (role member). Each entry has a userId used by other tools.",
      inputSchema: z.object({
        search: z.string().max(200).optional().describe("Matches name or email"),
        ...paging,
      }),
      handler: async (input, actor) =>
        clients.list(actor.organization.id, input.page, input.limit, input.search),
    }),
    defineTool({
      name: "get_client",
      description: "Returns one person's membership, company profile, and the projects they can see.",
      inputSchema: z.object({ clientUserId: z.string().describe("userId from list_clients") }),
      handler: async (input, actor) => {
        const orgId: string = actor.organization.id;
        const member = await clients.findMember(input.clientUserId, orgId);
        const [profile, clientProjects] = await Promise.all([
          clients.getProfile(input.clientUserId, orgId),
          projects.findByClient(input.clientUserId, orgId, { page: 1, limit: 50 }),
        ]);
        return { member, profile, projects: clientProjects.data };
      },
    }),
  ];
}
```

Create `apps/api/src/mcp/tools/tasks.tools.ts`:

```ts
import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { TasksService } from "../../tasks/tasks.service";

const isoDate = z.string().describe("ISO 8601 date, e.g. 2026-10-01");

export function taskTools(deps: { tasks: TasksService }): McpTool[] {
  const { tasks } = deps;
  return [
    defineTool({
      name: "list_tasks",
      description: "Lists a project's tasks. status 'active' means open or in progress.",
      inputSchema: z.object({
        projectId: z.string(),
        status: z.enum(["active", "all", "open", "in_progress", "done", "cancelled"]).default("active"),
        ...paging,
      }),
      handler: async (input, actor) =>
        tasks.findByProject(input.projectId, actor.organization.id, input.page, input.limit, input.status),
    }),
    defineTool({
      name: "create_task",
      description: "Adds a checkbox task to a project. Clients of the project can see it.",
      inputSchema: z.object({
        projectId: z.string(),
        title: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
        dueDate: isoDate.optional(),
      }),
      handler: async (input, actor) => {
        const { projectId, ...dto } = input;
        return tasks.create(dto, projectId, actor.organization.id);
      },
    }),
    defineTool({
      name: "update_task",
      description:
        "Updates a task. Set status to 'done' to complete it. Pass null for dueDate or assigneeId to clear them.",
      inputSchema: z.object({
        taskId: z.string(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).optional(),
        dueDate: isoDate.nullable().optional(),
        status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
        assigneeId: z.string().nullable().optional().describe("userId of a team member, or null to unassign"),
      }),
      handler: async (input, actor) => {
        const { taskId, ...dto } = input;
        return tasks.update(taskId, dto, actor.organization.id);
      },
    }),
    defineTool({
      name: "delete_task",
      description: "Permanently deletes a task.",
      inputSchema: z.object({ taskId: z.string() }),
      handler: async (input, actor) => tasks.remove(input.taskId, actor.organization.id),
    }),
  ];
}
```

- [ ] **Step 4: Run the tests and type-check**

Run: `cd apps/api && bun test src/mcp/tools && bunx tsc --noEmit -p tsconfig.json`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/mcp/tools
git commit -m "feat(api): MCP client and task tools"
```

---

### Task 9: Update and note tools

**Files:**
- Create: `apps/api/src/mcp/tools/updates.tools.ts`
- Create: `apps/api/src/mcp/tools/notes.tools.ts`
- Test: `apps/api/src/mcp/tools/updates.tools.spec.ts`, `apps/api/src/mcp/tools/notes.tools.spec.ts`

**Interfaces:**
- Consumes: `UpdatesService.create(dto: { content: string }, projectId, organizationId, authorId, role)`, `UpdatesService.findByProject(projectId, organizationId, page, limit)`; `NotesService.create(content, projectId, orgId, authorId)`, `findByProject(projectId, orgId, page, limit)`, `remove(id, orgId)`.
- Produces: `updateTools(deps: { updates: UpdatesService }): McpTool[]`, `noteTools(deps: { notes: NotesService }): McpTool[]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/mcp/tools/updates.tools.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { updateTools } from "./updates.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const updates = {
    findByProject: mock(() => Promise.resolve({ data: [], meta: {} })),
    create: mock(() => Promise.resolve({ id: "up1" })),
  };
  const tools = updateTools({ updates: updates as never });
  return { updates, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("update tools", () => {
  it("list_updates pages through a project's updates", async () => {
    const { updates, get } = build();
    const input = get("list_updates").inputSchema.parse({ projectId: "p1", page: 2 });
    await runTool(get("list_updates"), input, admin);
    expect(updates.findByProject).toHaveBeenCalledWith("p1", "org1", 2, 20);
  });

  it("post_update authors the update as the acting user", async () => {
    const { updates, get } = build();
    await runTool(get("post_update"), { projectId: "p1", content: "Shipped v2" }, admin);
    expect(updates.create).toHaveBeenCalledWith({ content: "Shipped v2" }, "p1", "org1", "u1", "admin");
  });

  it("post_update rejects empty and oversized content", () => {
    const schema = build().get("post_update").inputSchema;
    expect(schema.safeParse({ projectId: "p1", content: "" }).success).toBe(false);
    expect(schema.safeParse({ projectId: "p1", content: "x".repeat(5001) }).success).toBe(false);
  });
});
```

Create `apps/api/src/mcp/tools/notes.tools.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { noteTools } from "./notes.tools";
import { runTool } from "../tool-kit";
import type { Actor } from "../../common";

const admin = { user: { id: "u1" }, organization: { id: "org1" }, member: { role: "admin" } } as unknown as Actor;

function build() {
  const notes = {
    findByProject: mock(() => Promise.resolve({ data: [], meta: {} })),
    create: mock(() => Promise.resolve({ id: "n1" })),
    remove: mock(() => Promise.resolve()),
  };
  const tools = noteTools({ notes: notes as never });
  return { notes, get: (n: string) => tools.find((t) => t.name === n)! };
}

describe("note tools", () => {
  it("add_note authors the note as the acting user", async () => {
    const { notes, get } = build();
    await runTool(get("add_note"), { projectId: "p1", content: "Client prefers email" }, admin);
    expect(notes.create).toHaveBeenCalledWith("Client prefers email", "p1", "org1", "u1");
  });

  it("list_notes and delete_note are scoped to the org", async () => {
    const { notes, get } = build();
    await runTool(get("list_notes"), get("list_notes").inputSchema.parse({ projectId: "p1" }), admin);
    await runTool(get("delete_note"), { noteId: "n1" }, admin);
    expect(notes.findByProject).toHaveBeenCalledWith("p1", "org1", 1, 20);
    expect(notes.remove).toHaveBeenCalledWith("n1", "org1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/mcp/tools/updates.tools.spec.ts src/mcp/tools/notes.tools.spec.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/mcp/tools/updates.tools.ts`:

```ts
import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { UpdatesService } from "../../updates/updates.service";

export function updateTools(deps: { updates: UpdatesService }): McpTool[] {
  const { updates } = deps;
  return [
    defineTool({
      name: "list_updates",
      description: "Lists the progress updates posted on a project, newest first.",
      inputSchema: z.object({ projectId: z.string(), ...paging }),
      handler: async (input, actor) =>
        updates.findByProject(input.projectId, actor.organization.id, input.page, input.limit),
    }),
    defineTool({
      name: "post_update",
      description:
        "Posts a progress update to a project. The project's clients see it in their portal and may be notified by email, so confirm the wording with the user first.",
      inputSchema: z.object({
        projectId: z.string(),
        content: z.string().min(1).max(5000),
      }),
      handler: async (input, actor) =>
        updates.create(
          { content: input.content },
          input.projectId,
          actor.organization.id,
          actor.user.id,
          actor.member.role,
        ),
    }),
  ];
}
```

Create `apps/api/src/mcp/tools/notes.tools.ts`:

```ts
import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { NotesService } from "../../notes/notes.service";

export function noteTools(deps: { notes: NotesService }): McpTool[] {
  const { notes } = deps;
  return [
    defineTool({
      name: "list_notes",
      description: "Lists a project's internal notes. Notes are visible to the team only, never to clients.",
      inputSchema: z.object({ projectId: z.string(), ...paging }),
      handler: async (input, actor) =>
        notes.findByProject(input.projectId, actor.organization.id, input.page, input.limit),
    }),
    defineTool({
      name: "add_note",
      description: "Adds an internal note to a project. Clients never see notes.",
      inputSchema: z.object({
        projectId: z.string(),
        content: z.string().min(1).max(5000),
      }),
      handler: async (input, actor) =>
        notes.create(input.content, input.projectId, actor.organization.id, actor.user.id),
    }),
    defineTool({
      name: "delete_note",
      description: "Permanently deletes an internal note.",
      inputSchema: z.object({ noteId: z.string() }),
      handler: async (input, actor) => notes.remove(input.noteId, actor.organization.id),
    }),
  ];
}
```

- [ ] **Step 4: Run the tests and type-check**

Run: `cd apps/api && bun test src/mcp && bunx tsc --noEmit -p tsconfig.json`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/mcp/tools
git commit -m "feat(api): MCP update and note tools"
```

---

### Task 10: MCP service, controller, and rate limiter

**Files:**
- Create: `apps/api/src/mcp/rate-limiter.ts`
- Create: `apps/api/src/mcp/mcp.service.ts`
- Create: `apps/api/src/mcp/mcp.controller.ts`
- Create: `apps/api/src/mcp/mcp.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/mcp/rate-limiter.spec.ts`, `apps/api/src/mcp/mcp.service.spec.ts`

**Interfaces:**
- Consumes: all `*Tools` factories (Tasks 7–9), `runTool`, `McpTool` (Task 5), `Actor`, `AuthenticatedRequest.apiKeyId`.
- Produces:
  - `class RateLimiter { constructor(limit: number, windowMs: number); allow(key: string, now?: number): boolean }`
  - `McpService.tools(): McpTool[]`, `McpService.buildServer(actor: Actor): McpServer`, `McpService.handle(req: Request, res: Response): Promise<void>`
  - `POST /api/mcp`; `GET` and `DELETE /api/mcp` → 405.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/mcp/rate-limiter.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  it("allows up to the limit within the window, then blocks", () => {
    const limiter = new RateLimiter(300, 60_000);
    for (let i = 0; i < 300; i++) expect(limiter.allow("k1", 1_000)).toBe(true);
    expect(limiter.allow("k1", 1_000)).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 0)).toBe(false);
  });

  it("frees capacity once the window slides past old requests", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 59_999)).toBe(false);
    expect(limiter.allow("a", 60_001)).toBe(true);
  });
});
```

Create `apps/api/src/mcp/mcp.service.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import type { Request, Response } from "express";
import { McpService } from "./mcp.service";

function buildService(): McpService {
  const stub = {} as never;
  return new McpService(stub, stub, stub, stub, stub, stub);
}

function buildRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: mock((code: number) => { res.statusCode = code; return res; }),
    set: mock((k: string, v: string) => { res.headers[k] = v; return res; }),
    json: mock((b: unknown) => { res.body = b; return res; }),
  };
  return res;
}

describe("McpService", () => {
  it("registers exactly the 19 documented tools, with unique names", () => {
    const names = buildService().tools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual([
      "add_note", "archive_project", "create_project", "create_task", "delete_note",
      "delete_project", "delete_task", "get_client", "get_project", "get_workspace",
      "list_clients", "list_notes", "list_project_statuses", "list_projects", "list_tasks",
      "list_updates", "post_update", "update_project", "update_task",
    ]);
  });

  it("every tool has a description of at least 20 characters", () => {
    for (const tool of buildService().tools()) {
      expect(tool.description.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("responds 401 with WWW-Authenticate when the request has no identity", async () => {
    const res = buildRes();
    await buildService().handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toBe("Bearer");
    expect(res.body).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  });

  it("responds 403 for a signed-in portal client", async () => {
    const res = buildRes();
    const req = { headers: {}, user: { id: "u2" }, organization: { id: "org1" }, member: { role: "member" } };
    await buildService().handle(req as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/mcp/rate-limiter.spec.ts src/mcp/mcp.service.spec.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the rate limiter**

Create `apps/api/src/mcp/rate-limiter.ts`:

```ts
/** In-memory sliding-window limiter. One instance per process is enough for MCP. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const cutoff: number = now - this.windowMs;
    const recent: number[] = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.evict(cutoff);
    return true;
  }

  private evict(cutoff: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }
}
```

- [ ] **Step 4: Implement the service**

Create `apps/api/src/mcp/mcp.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { Actor, AuthenticatedRequest } from "../common";
import { ProjectsService } from "../projects/projects.service";
import { TasksService } from "../tasks/tasks.service";
import { UpdatesService } from "../updates/updates.service";
import { NotesService } from "../notes/notes.service";
import { ClientsService } from "../clients/clients.service";
import { BillingService } from "../billing/billing.service";
import { RateLimiter } from "./rate-limiter";
import { runTool } from "./tool-kit";
import type { McpTool } from "./tool-kit";
import { workspaceTools } from "./tools/workspace.tools";
import { projectTools } from "./tools/projects.tools";
import { clientTools } from "./tools/clients.tools";
import { taskTools } from "./tools/tasks.tools";
import { updateTools } from "./tools/updates.tools";
import { noteTools } from "./tools/notes.tools";

const MCP_ROLES: string[] = ["owner", "admin"];
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60_000;

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly limiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

  constructor(
    private projects: ProjectsService,
    private tasks: TasksService,
    private updates: UpdatesService,
    private notes: NotesService,
    private clients: ClientsService,
    private billing: BillingService,
  ) {}

  tools(): McpTool[] {
    return [
      ...workspaceTools(),
      ...projectTools({ projects: this.projects, billing: this.billing }),
      ...clientTools({ clients: this.clients, projects: this.projects }),
      ...taskTools({ tasks: this.tasks }),
      ...updateTools({ updates: this.updates }),
      ...noteTools({ notes: this.notes }),
    ];
  }

  /** One server per request; the actor is closed over so tools never read transport context. */
  buildServer(actor: Actor): McpServer {
    const server = new McpServer({ name: "atrium", version: "1.0.0" });
    for (const tool of this.tools()) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (input: unknown) => runTool(tool, input, actor),
      );
    }
    return server;
  }

  async handle(req: Request, res: Response): Promise<void> {
    const { user, organization, member, apiKeyId } = req as Partial<AuthenticatedRequest>;

    if (!user || !organization || !member) {
      res
        .status(401)
        .set("WWW-Authenticate", "Bearer")
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    if (!MCP_ROLES.includes(member.role)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "MCP access requires the owner or admin role" },
        id: null,
      });
      return;
    }
    if (!this.limiter.allow(apiKeyId ?? user.id)) {
      res.status(429).set("Retry-After", "60").json({
        jsonrpc: "2.0",
        error: { code: -32029, message: "Rate limit exceeded. Retry in 60 seconds." },
        id: null,
      });
      return;
    }

    const server: McpServer = this.buildServer({ user, organization, member });
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close().catch((err: unknown) => this.logger.warn(`transport close failed: ${String(err)}`));
      server.close().catch((err: unknown) => this.logger.warn(`server close failed: ${String(err)}`));
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error("MCP request failed", err instanceof Error ? err.stack : String(err));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  }
}
```

`enableJsonResponse: true` makes the transport answer with plain JSON instead of an SSE stream. The API runs `compression()`, which buffers event streams, and no tool here streams progress.

If `bunx tsc` rejects the `registerTool` callback signature, read the overloads in `node_modules/@modelcontextprotocol/server/dist/*.d.mts` (search `registerTool<`) and adapt only the call site; `runTool`'s return value already matches the SDK's `CallToolResult` shape (`content` array of `{ type: "text", text }`, optional `isError`).

- [ ] **Step 5: Implement the controller and module**

Create `apps/api/src/mcp/mcp.controller.ts`:

```ts
import { Controller, Delete, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "../common";
import { McpService } from "./mcp.service";

/**
 * @Public because the handler does its own identity check (it controls the
 * 401 headers MCP clients rely on). @SkipThrottle because the IP-based global
 * limit is replaced by a per-key limit inside McpService. Never takes @Body(),
 * so the global ValidationPipe leaves JSON-RPC payloads alone.
 */
@Controller("mcp")
@Public()
@SkipThrottle()
export class McpController {
  constructor(private mcp: McpService) {}

  @Post()
  @HttpCode(200)
  async post(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.mcp.handle(req, res);
  }

  @Get()
  get(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  @Delete()
  delete(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  private methodNotAllowed(res: Response): void {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This server is stateless; use POST." },
      id: null,
    });
  }
}
```

Create `apps/api/src/mcp/mcp.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { TasksModule } from "../tasks/tasks.module";
import { UpdatesModule } from "../updates/updates.module";
import { NotesModule } from "../notes/notes.module";
import { ClientsModule } from "../clients/clients.module";
import { BillingModule } from "../billing/billing.module";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

@Module({
  imports: [ProjectsModule, TasksModule, UpdatesModule, NotesModule, ClientsModule, BillingModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
```

In `apps/api/src/app.module.ts`, add `import { McpModule } from "./mcp/mcp.module";` and `McpModule,` after `ApiKeysModule,`.

- [ ] **Step 6: Run the tests and type-check**

Run: `cd apps/api && bun test src/mcp && bunx tsc --noEmit -p tsconfig.json`
Expected: all pass, no type errors.

- [ ] **Step 7: Smoke test against the running API**

Run `bun run dev` in one terminal (needs Docker for Postgres; `db push` creates `api_key`). In another:

```bash
curl -s -i -X POST http://localhost:3001/api/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Expected: `HTTP/1.1 401` with `WWW-Authenticate: Bearer`. Then `curl -s -i http://localhost:3001/api/mcp` → `405` with `Allow: POST`. If the API fails to boot with a Nest dependency error, a module from Step 5 of Task 6 is missing its `exports`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/mcp apps/api/src/app.module.ts
git commit -m "feat(api): stateless MCP endpoint at /api/mcp"
```

---

### Task 11: Integration test

**Files:**
- Create: `apps/api/test/integration/mcp.integration.spec.ts`

**Interfaces:**
- Consumes: `ApiKeysService`, `SessionMiddleware`, `McpService`, real `PrismaService`, the SDK client (`Client`, `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`).

- [ ] **Step 1: Write the test**

Create `apps/api/test/integration/mcp.integration.spec.ts`:

```ts
/**
 * Drives the real MCP endpoint with the official SDK client over HTTP, against
 * a real database: key → SessionMiddleware → McpService → ProjectsService →
 * Postgres. The unit tests mock every one of those seams.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertDisposableDatabase } from "./guard";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ApiKeysService } from "../../src/api-keys/api-keys.service";
import { SessionMiddleware } from "../../src/auth/session.middleware";
import { McpService } from "../../src/mcp/mcp.service";
import { ProjectsService } from "../../src/projects/projects.service";
import { NotesService } from "../../src/notes/notes.service";
import type { AuthService } from "../../src/auth/auth.service";
import type { BillingService } from "../../src/billing/billing.service";

let prisma: PrismaService;
let apiKeys: ApiKeysService;
let server: Server;
let url: URL;
let orgId: string;
let adminKey: string;
let adminKeyId: string;

const stamp = `${Date.now()}`;

async function connect(key: string): Promise<Client> {
  const client = new Client({ name: "integration", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return client;
}

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();

  orgId = `org-${stamp}`;
  await prisma.organization.create({ data: { id: orgId, name: "MCP Test Org", slug: `mcp-${stamp}` } });
  await prisma.user.create({ data: { id: `admin-${stamp}`, name: "Admin", email: `admin-${stamp}@test.com` } });
  await prisma.member.create({ data: { id: `m-${stamp}`, organizationId: orgId, userId: `admin-${stamp}`, role: "admin" } });

  apiKeys = new ApiKeysService(prisma);
  const created = await apiKeys.create("integration", `admin-${stamp}`, orgId);
  adminKey = created.key;
  adminKeyId = created.id;

  const authStub = { auth: { api: { getSession: async () => null } } } as unknown as AuthService;
  const billingStub = { assertPlanLimit: async () => undefined } as unknown as BillingService;
  const middleware = new SessionMiddleware(authStub, apiKeys);
  const unused = {} as never;
  const mcp = new McpService(
    new ProjectsService(prisma), unused, unused, new NotesService(prisma), unused, billingStub,
  );

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use((req, res, next) => void middleware.use(req, res, next));
  app.post("/api/mcp", (req, res) => void mcp.handle(req, res));

  server = app.listen(0);
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`);
});

afterAll(async () => {
  server?.close();
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: `admin-${stamp}` } });
  await prisma.$disconnect();
});

describe("MCP endpoint", () => {
  it("lists tools for a valid key", async () => {
    const client = await connect(adminKey);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("create_project");
    expect(tools.length).toBe(19);
    await client.close();
  });

  it("create_project writes to Postgres in the key's org, and list_projects reads it back", async () => {
    const client = await connect(adminKey);

    const created = await client.callTool({ name: "create_project", arguments: { name: `MCP Project ${stamp}` } });
    expect(created.isError).toBeFalsy();
    const projectId: string = JSON.parse(textOf(created)).id;

    const row = await prisma.project.findUnique({ where: { id: projectId } });
    expect(row?.organizationId).toBe(orgId);

    const listed = await client.callTool({ name: "list_projects", arguments: { search: stamp } });
    expect(JSON.parse(textOf(listed)).data.map((p: { id: string }) => p.id)).toContain(projectId);

    await client.callTool({ name: "add_note", arguments: { projectId, content: "from mcp" } });
    expect(await prisma.projectNote.count({ where: { projectId, authorId: `admin-${stamp}` } })).toBe(1);
    await client.close();
  });

  it("cannot read another org's project", async () => {
    await prisma.organization.create({ data: { id: `other-${stamp}`, name: "Other", slug: `other-${stamp}` } });
    const foreign = await prisma.project.create({ data: { name: "Secret", organizationId: `other-${stamp}` } });
    const client = await connect(adminKey);

    const result = await client.callTool({ name: "get_project", arguments: { projectId: foreign.id } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Project not found");
    await client.close();
    await prisma.organization.deleteMany({ where: { id: `other-${stamp}` } });
  });

  it("blocks delete_project for an admin", async () => {
    const client = await connect(adminKey);
    const project = await prisma.project.create({ data: { name: "Keep me", organizationId: orgId } });
    const result = await client.callTool({ name: "delete_project", arguments: { projectId: project.id } });
    expect(result.isError).toBe(true);
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(1);
    await client.close();
  });

  it("rejects requests with no key and with a revoked key", async () => {
    const noKey = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(noKey.status).toBe(401);
    expect(noKey.headers.get("www-authenticate")).toBe("Bearer");

    const fresh = await apiKeys.create("to-revoke", `admin-${stamp}`, orgId);
    await apiKeys.revoke(fresh.id, orgId);
    await expect(connect(fresh.key)).rejects.toThrow();
    expect(adminKeyId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it**

Run (from the repo root): `bun run test:integration`
Expected: the new file's 5 tests pass along with the existing integration tests. If `prisma.project.create` fails on a required column, open `model Project` in `schema.prisma` and add the missing required fields to the two direct `create` calls in this test.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/mcp.integration.spec.ts
git commit -m "test(api): MCP endpoint integration test"
```

---

### Task 12: Settings page

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/api-keys-section.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connect-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/settings/layout.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/api-keys` (Task 4); `apiFetch` from `@/lib/api`; `useToast` from `@/components/toast`; `useConfirm` from `@/components/confirm-modal`; `copyToClipboard(text: string): Promise<boolean>` from `@/lib/clipboard`.
- Produces: page at `/dashboard/settings/api-keys` with headings "API keys" and "Connect an AI assistant", an input with placeholder `Key name (e.g. Claude agent)`, a "Create key" button, a one-time key display with `data-testid="new-api-key"`, toasts "API key created" and "API key revoked", and per-row "Revoke" buttons.

- [ ] **Step 1: Add the nav entry**

In `apps/web/src/app/(dashboard)/dashboard/settings/layout.tsx`, add to `SECTIONS` after the Payments entry:

```ts
  { href: "/dashboard/settings/api-keys", label: "API & MCP" },
```

- [ ] **Step 2: Create the keys section**

Create `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/api-keys-section.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: string;
}

interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: string;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "Never";
}

export function ApiKeysSection(): React.ReactElement {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [name, setName] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const { success, error: showError } = useToast();
  const confirm = useConfirm();

  const loadKeys = (): void => {
    apiFetch<ApiKeySummary[]>("/api-keys")
      .then((data) => setKeys(data))
      .catch((err: unknown) => {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to load API keys");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const created = await apiFetch<CreatedApiKey>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setNewKey(created.key);
      setName("");
      success("API key created");
      loadKeys();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!newKey) return;
    const copied: boolean = await copyToClipboard(newKey);
    if (copied) success("Copied to clipboard");
    else showError("Could not copy. Select the key and copy it manually.");
  };

  const handleRevoke = async (key: ApiKeySummary): Promise<void> => {
    const ok = await confirm({
      title: "Revoke API key",
      message: `Revoke "${key.name}"? Anything using it will stop working immediately.`,
      confirmLabel: "Revoke",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api-keys/${key.id}`, { method: "DELETE" });
      success("API key revoked");
      loadKeys();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to revoke API key");
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border)] p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound size={18} /> API keys
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          A key acts as you in this workspace. Treat it like a password and revoke it if it leaks.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
          placeholder="Key name (e.g. Claude agent)"
          className="flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!name.trim() || creating}
          className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create key
        </button>
      </div>

      {newKey && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-medium">Copy this key now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code data-testid="new-api-key" className="flex-1 break-all rounded bg-[var(--muted)] px-2 py-1 text-xs">
              {newKey}
            </code>
            <button type="button" onClick={() => void handleCopy()} aria-label="Copy key" className="p-2">
              <Copy size={16} />
            </button>
          </div>
          <button type="button" onClick={() => setNewKey(null)} className="text-sm underline">
            I have saved it
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No API keys yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--muted-foreground)]">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Created by</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Last used</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-t border-[var(--border)]">
                <td className="py-2">{key.name}</td>
                <td className="py-2"><code className="text-xs">{key.keyPrefix}…</code></td>
                <td className="py-2">{key.createdBy}</td>
                <td className="py-2">{formatDate(key.createdAt)}</td>
                <td className="py-2">{formatDate(key.lastUsedAt)}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void handleRevoke(key)}
                    className="inline-flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <Trash2 size={14} /> Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Create the connect card**

Create `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connect-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/components/toast";

type ClientId = "claude-code" | "json" | "anthropic-api";

interface Snippet {
  id: ClientId;
  label: string;
  code: (url: string) => string;
}

const SNIPPETS: Snippet[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    code: (url) =>
      `claude mcp add --transport http atrium ${url} \\\n  --header "Authorization: Bearer YOUR_API_KEY"`,
  },
  {
    id: "json",
    label: "Cursor / JSON config",
    code: (url) =>
      JSON.stringify(
        { mcpServers: { atrium: { url, headers: { Authorization: "Bearer YOUR_API_KEY" } } } },
        null,
        2,
      ),
  },
  {
    id: "anthropic-api",
    label: "Anthropic API",
    code: (url) =>
      JSON.stringify(
        {
          mcp_servers: [{ type: "url", url, name: "atrium", authorization_token: "YOUR_API_KEY" }],
          tools: [{ type: "mcp_toolset", mcp_server_name: "atrium" }],
        },
        null,
        2,
      ),
  },
];

function mcpUrl(): string {
  const base: string =
    process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/api/mcp`;
}

export function ConnectCard(): React.ReactElement {
  const [active, setActive] = useState<ClientId>("claude-code");
  const { success, error: showError } = useToast();
  const url: string = mcpUrl();
  const snippet: Snippet = SNIPPETS.find((s) => s.id === active) ?? SNIPPETS[0];

  const copy = async (text: string): Promise<void> => {
    const copied: boolean = await copyToClipboard(text);
    if (copied) success("Copied to clipboard");
    else showError("Could not copy");
  };

  return (
    <section className="rounded-lg border border-[var(--border)] p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Connect an AI assistant</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Atrium speaks the Model Context Protocol (MCP). Point any MCP client at this URL and send an API
          key as a bearer token. Works with Claude, OpenAI, local models, and agent frameworks.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code data-testid="mcp-url" className="flex-1 break-all rounded bg-[var(--muted)] px-2 py-1 text-xs">
          {url}
        </code>
        <button type="button" onClick={() => void copy(url)} aria-label="Copy MCP URL" className="p-2">
          <Copy size={16} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            className={`px-3 py-1.5 text-sm ${
              s.id === active ? "border-b-2 border-[var(--primary)] font-medium" : "text-[var(--muted-foreground)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded bg-[var(--muted)] p-3 text-xs">{snippet.code(url)}</pre>
        <button
          type="button"
          onClick={() => void copy(snippet.code(url))}
          aria-label="Copy snippet"
          className="absolute right-2 top-2 p-1"
        >
          <Copy size={14} />
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create the page**

Create `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx`:

```tsx
import { ApiKeysSection } from "./api-keys-section";
import { ConnectCard } from "./connect-card";

export default function ApiKeysPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <ApiKeysSection />
      <ConnectCard />
    </div>
  );
}
```

- [ ] **Step 5: Lint, type-check, and look at it**

Run: `cd apps/web && bunx tsc --noEmit && bun run lint`
Expected: no errors. With `bun run dev` running, open `http://localhost:3000/dashboard/settings/api-keys`, create a key, confirm the amber one-time box shows a key starting `atr_`, confirm the table row shows the 12-character prefix, revoke it. Compare the look against `/dashboard/settings/workspace`; if the card borders or button styles differ from the sections there, copy that page's class names rather than inventing new ones.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/settings"
git commit -m "feat(web): API keys and MCP connection settings page"
```

---

### Task 13: E2E test

**Files:**
- Create: `e2e/tests/api-keys.e2e.ts`

**Interfaces:**
- Consumes: the page contract from Task 12; `POST /api/mcp`. The Playwright project is already signed in as an owner through `storageState`.

- [ ] **Step 1: Write the test**

Create `e2e/tests/api-keys.e2e.ts`:

```ts
import { test, expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

const API_URL = "http://localhost:3001";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } },
};

/** Calls the MCP endpoint with only a bearer key: no cookies from the signed-in browser context. */
async function mcpInitialize(request: APIRequestContext, key: string): Promise<APIResponse> {
  return request.post(`${API_URL}/api/mcp`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    data: INITIALIZE,
  });
}

test.describe("API keys and MCP", () => {
  test("settings tab is reachable", async ({ page }) => {
    await page.goto("/dashboard/settings/account");
    await page.getByRole("link", { name: "API & MCP" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings\/api-keys/);
    await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect an AI assistant" })).toBeVisible();
    await expect(page.getByTestId("mcp-url")).toContainText("/api/mcp");
  });

  test("create a key, use it over MCP, revoke it, and it stops working", async ({ page, playwright }) => {
    const keyName = `E2E key ${Date.now()}`;
    await page.goto("/dashboard/settings/api-keys");
    await expect(page.getByText("Loading...").first()).not.toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder("Key name (e.g. Claude agent)").fill(keyName);
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText(/api key created/i)).toBeVisible({ timeout: 5000 });

    // Shown exactly once, in full
    const key = (await page.getByTestId("new-api-key").innerText()).trim();
    expect(key).toMatch(/^atr_[A-Za-z0-9_-]{43}$/);

    // The table shows only the prefix
    const row = page.getByRole("row").filter({ hasText: keyName });
    await expect(row).toContainText(`${key.slice(0, 12)}…`);
    await expect(row).not.toContainText(key);

    // After dismissing and reloading, the full key is gone for good
    await page.getByRole("button", { name: "I have saved it" }).click();
    await page.reload();
    await expect(page.getByTestId("new-api-key")).toHaveCount(0);

    // A cookie-less client can use the key
    const bare = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const before = await mcpInitialize(bare, key);
    expect(before.status()).toBe(200);
    expect((await before.json()).result.serverInfo.name).toBe("atrium");

    // Revoke
    await page.getByRole("row").filter({ hasText: keyName }).getByRole("button", { name: /revoke/i }).click();
    await page.getByRole("button", { name: "Revoke" }).last().click();
    await expect(page.getByText(/api key revoked/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("row").filter({ hasText: keyName })).toHaveCount(0);

    // SessionMiddleware caches resolved keys for up to 30 seconds
    await expect
      .poll(async () => (await mcpInitialize(bare, key)).status(), { timeout: 40_000, intervals: [2_000] })
      .toBe(401);
    await bare.dispose();
  });

  test("MCP endpoint rejects requests without a key", async ({ playwright }) => {
    const bare = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await bare.post(`${API_URL}/api/mcp`, { data: INITIALIZE });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toBe("Bearer");
    await bare.dispose();
  });
});
```

- [ ] **Step 2: Run it**

Run: `bunx playwright test --config=e2e/playwright.config.ts e2e/tests/api-keys.e2e.ts`
Expected: 3 passed. If the confirm dialog's button is not found, open `apps/web/src/components/confirm-modal.tsx` and match its confirm button's accessible name.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/api-keys.e2e.ts
git commit -m "test(e2e): API keys settings and MCP endpoint"
```

---

### Task 14: Documentation

**Files:**
- Create: `docs/mcp.md`
- Modify: `README.md` (features list)
- Modify: `docs/roadmap.md`
- Modify: `docs/security.md`
- Modify: `CLAUDE.md` (API Structure list)

- [ ] **Step 1: Write `docs/mcp.md`**

````markdown
# MCP Server (AI assistants)

Atrium includes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI
assistants and agents can view and manage your workspace. It works with any MCP client
and any model provider: Claude, OpenAI, local models behind Open WebUI or LibreChat,
n8n, or your own agent.

- **Endpoint:** `https://<your-atrium-host>/api/mcp` (Streamable HTTP, stateless)
- **Auth:** an API key sent as `Authorization: Bearer atr_…`

## 1. Create an API key

Go to **Settings → API & MCP**, name the key, and click **Create key**. Copy it
immediately; Atrium stores only a hash and cannot show it again.

A key acts as **you** in **that workspace**, with your role. Only owners and admins can
create keys. If you are later demoted or removed, your keys stop working. Revoke a key
from the same page; revocation takes effect within 30 seconds.

## 2. Connect a client

**Claude Code**

```bash
claude mcp add --transport http atrium https://portal.example.com/api/mcp \
  --header "Authorization: Bearer atr_your_key"
```

**Cursor, Claude Desktop, and other JSON-configured clients**

```json
{
  "mcpServers": {
    "atrium": {
      "url": "https://portal.example.com/api/mcp",
      "headers": { "Authorization": "Bearer atr_your_key" }
    }
  }
}
```

Clients that only support stdio servers can bridge with
`npx mcp-remote https://portal.example.com/api/mcp --header "Authorization: Bearer atr_your_key"`.

**Anthropic Messages API (MCP connector)**

```json
{
  "mcp_servers": [
    { "type": "url", "url": "https://portal.example.com/api/mcp", "name": "atrium", "authorization_token": "atr_your_key" }
  ],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "atrium" }]
}
```

Send the beta header `anthropic-beta: mcp-client-2025-11-20`. The Anthropic API must be
able to reach your instance, so it needs a public URL.

**Local models.** Point your MCP-capable front end (Open WebUI, LibreChat, LM Studio,
and similar) at the same URL with the same header. Nothing leaves your network.

## Tools

| Tool | What it does |
| --- | --- |
| `get_workspace` | The workspace and user this connection acts as |
| `list_projects`, `get_project` | Browse projects |
| `create_project`, `update_project`, `archive_project` | Manage projects |
| `delete_project` | Permanently delete a project (owner only) |
| `list_project_statuses` | The workspace's status options |
| `list_clients`, `get_client` | People in the workspace, their profile and projects |
| `list_tasks`, `create_task`, `update_task`, `delete_task` | Manage tasks |
| `list_updates`, `post_update` | Client-visible progress updates |
| `list_notes`, `add_note`, `delete_note` | Internal notes (never visible to clients) |

List tools take `page` and `limit` (max 50). `post_update` is visible to clients and
may trigger email notifications.

## Limits and security

- 300 requests per minute per key. Over the limit returns `429` with `Retry-After`.
- Treat keys like passwords. Anyone holding a key can do what you can do in that workspace.
- Keys also authenticate the REST API (`/api/*`) with the same permissions. Keys cannot
  create other keys.
- Give each assistant its own key so you can revoke one without disturbing the others.
````

- [ ] **Step 2: Update the other docs**

- `README.md`: add to the features list: `- **MCP server** -- connect Claude, ChatGPT-style agents, or local models to manage projects, tasks, and updates ([docs](docs/mcp.md))`
- `docs/roadmap.md`: add a checked item near the Webhooks/Zapier line: `- [x] **MCP server** -- AI assistants can manage the workspace via API keys ([docs](mcp.md))`
- `docs/security.md`: add a section:

```markdown
## API keys

API keys (`atr_…`) are generated from 32 random bytes and stored only as SHA-256 hashes.
A key is bound to one user and one organization and resolves only while that user is an
owner or admin there. Keys are ignored when a session cookie is present, cannot create
other keys, and are revocable from Settings → API & MCP. The MCP endpoint is rate limited
to 300 requests per minute per key.
```

- `CLAUDE.md`, in the "API Structure" list, add:

```markdown
- **API keys**: `api-keys/` -- `atr_` bearer keys (hashed), resolved in `SessionMiddleware` into the same `req.user/organization/member` as cookie sessions
- **MCP**: `mcp/` -- stateless MCP server at `POST /api/mcp`; tools in `mcp/tools/*.tools.ts` are thin adapters over existing services. The controller is `@Public()` and checks identity itself
```

- [ ] **Step 3: Run the whole suite**

Run: `bun run lint && bun run test && bun run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs README.md CLAUDE.md
git commit -m "docs: MCP server and API keys"
```
