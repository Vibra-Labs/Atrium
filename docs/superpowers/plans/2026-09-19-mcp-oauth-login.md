# MCP Server: OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect an MCP client by pasting only the Atrium MCP URL and signing in, so claude.ai, ChatGPT, Claude Code, and Cursor connectors work without an API key.

**Architecture:** Better Auth's built-in `mcp` plugin turns Atrium into an OAuth 2.1 authorization server (authorize, token, dynamic client registration, consent, discovery). A small `McpGrant` table binds each user-and-client pair to one workspace, chosen on a new consent page. The `SessionMiddleware` bearer branch resolves OAuth access tokens into the same `Actor` as API keys, but only on `/api/mcp`.

**Tech Stack:** Better Auth 1.4.18 (`better-auth/plugins` → `mcp`), NestJS 11, Prisma, Next.js 15, Bun test, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-mcp-server-design.md`, section 3, plus the OAuth rows of sections 4–7.

**Prerequisite:** `docs/superpowers/plans/2026-09-19-mcp-api-keys-and-endpoint.md` is fully implemented on this branch. This plan modifies files that plan creates (`session.middleware.ts` bearer branch, `mcp.service.ts`, the settings page).

## Global Constraints

- Branch: `feat/mcp-server`. Never commit to `main`. Never add `Co-Authored-By` or other attribution trailers.
- TypeScript: explicit types, no `any` in non-test code. Every `catch` logs.
- TDD where a test is listed. Unit tests do no I/O. Integration tests run only via `bun run test:integration`.
- OAuth access tokens are accepted **only** when the request path is exactly `/api/mcp`. They must never authenticate any other route.
- A grant resolves only while its user is `owner` or `admin` of the bound organization (same rule as API keys).
- Expiry is checked by Atrium: a token whose `accessTokenExpiresAt` is in the past is rejected.
- Lifetimes: access token 3600 seconds, refresh token 30 days. PKCE required. Dynamic client registration enabled.
- Env flag `MCP_OAUTH_ENABLED`, default `"true"`. When `"false"`: plugin not registered, discovery routes return 404, the 401 header is a bare `Bearer`, the Connected apps UI is hidden. API keys are unaffected.
- The database uses `prisma db push`. Every new table is also added to `packages/database/rls/enable-rls.sql`.
- The plugin source is the authority on request shapes. It lives at `node_modules/better-auth/dist/plugins/mcp/` (`index.mjs`, `authorize.mjs`) and `…/plugins/oidc-provider/`. If a request in this plan gets an unexpected status, read the handler there and fix the request, never the plugin.

## File Structure

```
packages/database/prisma/schema.prisma          + OauthApplication, OauthAccessToken, OauthConsent, McpGrant
packages/database/rls/enable-rls.sql            + 4 tables
apps/api/src/auth/auth.service.ts               + mcp plugin (flagged), register rate limit
apps/api/src/auth/well-known.controller.ts      4 discovery routes at the origin root
apps/api/src/auth/auth.module.ts                + WellKnownController, McpAuthModule
apps/api/src/main.ts                            exclude discovery paths from the "api" prefix
apps/api/src/mcp-auth/
  mcp-auth.module.ts
  mcp-auth.service.ts        resolve(token), grants CRUD
  mcp-auth.service.spec.ts
  mcp-grants.controller.ts   /api/mcp-grants
  mcp-grants.controller.spec.ts
  mcp-grants.dto.ts
  oauth-cleanup.task.ts      prune unused dynamic clients
apps/api/src/auth/session.middleware.ts         + OAuth branch on /api/mcp
apps/api/src/mcp/mcp.service.ts                 401 header carries resource_metadata
apps/api/test/integration/mcp-oauth.integration.spec.ts
docker/Caddyfile                                 route /.well-known/oauth-* to the API
apps/web/src/app/(auth)/login/login-form.tsx    resume OAuth after sign-in
apps/web/src/app/(auth)/oauth/consent/page.tsx
apps/web/src/app/(auth)/oauth/consent/consent-form.tsx
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connected-apps-section.tsx
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connect-card.tsx   lead with login
apps/web/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx
e2e/tests/mcp-oauth.e2e.ts
docs/mcp.md, docs/configuration.md, docs/security.md, .env.example
```

`McpAuthModule` is separate from `McpModule` on purpose: `AuthModule` must import it (the middleware needs it), and `McpModule` imports `ClientsModule`, which imports `AuthModule`. Putting the OAuth resolver inside `McpModule` would create a module cycle.

---

### Task 1: OAuth tables, the plugin, and a proving integration test

This task is the spike and the foundation at once: it proves the plugin's full authorization-code flow works with Atrium's Prisma schema and organization plugin before anything is built on it.

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/rls/enable-rls.sql`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `.env.example`
- Test: `apps/api/test/integration/mcp-oauth.integration.spec.ts`

**Interfaces:**
- Produces:
  - Prisma models `OauthApplication`, `OauthAccessToken`, `OauthConsent` (accessors `prisma.oauthApplication`, `prisma.oauthAccessToken`, `prisma.oauthConsent`) and `McpGrant` (`prisma.mcpGrant`, unique on `[userId, clientId]`).
  - Better Auth endpoints under `/api/auth`: `POST mcp/register`, `GET mcp/authorize`, `POST oauth2/consent`, `POST mcp/token`, `GET .well-known/oauth-authorization-server`, `GET .well-known/oauth-protected-resource`.
  - `auth.api.getMcpOAuthConfig()` and `auth.api.getMCPProtectedResource()`.
  - Test helper exports are local to the spec file; later tasks extend this same file.

- [ ] **Step 1: Add the models**

Append to `packages/database/prisma/schema.prisma` after `model ApiKey`:

```prisma
// ─── OAuth provider (Better Auth mcp plugin) ───
// Field names are dictated by better-auth/dist/plugins/oidc-provider/schema.mjs.

model OauthApplication {
  id           String   @id
  name         String
  icon         String?
  metadata     String?
  clientId     String   @unique
  clientSecret String?
  redirectUrls String
  type         String
  disabled     Boolean? @default(false)
  userId       String?
  createdAt    DateTime
  updatedAt    DateTime

  user         User?              @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessTokens OauthAccessToken[]
  consents     OauthConsent[]

  @@index([userId])
  @@map("oauth_application")
}

model OauthAccessToken {
  id                    String   @id
  accessToken           String   @unique
  refreshToken          String   @unique
  accessTokenExpiresAt  DateTime
  refreshTokenExpiresAt DateTime
  clientId              String
  userId                String?
  scopes                String
  createdAt             DateTime
  updatedAt             DateTime

  application OauthApplication @relation(fields: [clientId], references: [clientId], onDelete: Cascade)
  user        User?            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([clientId])
  @@index([userId])
  @@map("oauth_access_token")
}

model OauthConsent {
  id           String   @id
  clientId     String
  userId       String
  scopes       String
  createdAt    DateTime
  updatedAt    DateTime
  consentGiven Boolean

  application OauthApplication @relation(fields: [clientId], references: [clientId], onDelete: Cascade)
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([clientId])
  @@index([userId])
  @@map("oauth_consent")
}

/// Which workspace an OAuth client acts in for a given user. Chosen on the consent screen.
model McpGrant {
  id             String   @id @default(cuid())
  userId         String
  clientId       String
  organizationId String
  createdAt      DateTime @default(now())

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, clientId])
  @@index([organizationId])
  @@map("mcp_grant")
}
```

In `model User` add:

```prisma
  oauthApplications  OauthApplication[]
  oauthAccessTokens  OauthAccessToken[]
  oauthConsents      OauthConsent[]
  mcpGrants          McpGrant[]
```

In `model Organization` add:

```prisma
  mcpGrants      McpGrant[]
```

In `packages/database/rls/enable-rls.sql` add to the ENABLE block:

```sql
ALTER TABLE "oauth_application"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_access_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_consent"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_grant"          ENABLE ROW LEVEL SECURITY;
```

and to the REVOKE block:

```sql
REVOKE ALL ON "oauth_application"  FROM anon, authenticated;
REVOKE ALL ON "oauth_access_token" FROM anon, authenticated;
REVOKE ALL ON "oauth_consent"      FROM anon, authenticated;
REVOKE ALL ON "mcp_grant"          FROM anon, authenticated;
```

Run: `cd packages/database && bunx prisma validate && cd ../.. && bun run db:generate`
Expected: schema valid, client generated.

- [ ] **Step 2: Write the failing integration test**

Create `apps/api/test/integration/mcp-oauth.integration.spec.ts`:

```ts
/**
 * Proves Better Auth's mcp plugin works end to end against Atrium's Prisma
 * schema: dynamic registration → authorize (signed in) → consent → token.
 * Everything downstream (grants, the middleware branch, the consent page)
 * assumes this flow, so it is asserted against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHash, randomBytes } from "crypto";
import { assertDisposableDatabase } from "./guard";
import { AuthService } from "../../src/auth/auth.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { MailService } from "../../src/mail/mail.service";
import type { BillingService } from "../../src/billing/billing.service";

const API = "http://localhost:3001";
const WEB = "http://localhost:3000";
const REDIRECT_URI = "http://localhost:9999/callback";
const stamp = `${Date.now()}`;
const email = `oauth-${stamp}@test.com`;

let prisma: PrismaService;
let auth: AuthService;
let sessionCookie: string;
export let userId: string;
export let orgId: string;

const config = {
  get: (key: string, fallback?: string) => {
    if (key === "WEB_URL") return WEB;
    if (key === "API_URL") return API;
    if (key === "MCP_OAUTH_ENABLED") return "true";
    return fallback;
  },
  getOrThrow: (key: string) => {
    if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
    throw new Error(`Missing ${key}`);
  },
} as unknown as ConfigService;

const mail = { send: async () => undefined } as unknown as MailService;
const billing = { initializeFreePlan: async () => undefined } as unknown as BillingService;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", API);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return auth.auth.handler(new Request(`${API}/api/auth${path}`, { ...init, headers, redirect: "manual" }));
}

export async function registerClient(name: string): Promise<string> {
  const res = await call("/mcp/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as { client_id: string }).client_id;
}

/** Runs authorize → consent → token and returns the token response. */
export async function authorizeAndExchange(
  clientId: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const verifier: string = randomBytes(32).toString("base64url");
  const challenge: string = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state: "st8",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authorize = await call(`/mcp/authorize?${query}`);
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get("location")!);
  expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(`${WEB}/oauth/consent`);
  expect(consentUrl.searchParams.get("client_id")).toBe(clientId);
  const consentCode: string = consentUrl.searchParams.get("consent_code")!;

  const consent = await call("/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept: true, consent_code: consentCode }),
  });
  expect(consent.status).toBe(200);
  const callback = new URL(((await consent.json()) as { redirectURI: string }).redirectURI);
  expect(callback.searchParams.get("state")).toBe("st8");
  const code: string = callback.searchParams.get("code")!;

  const token = await call("/mcp/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });
  expect(token.status).toBe(200);
  return (await token.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  auth = new AuthService(config, prisma, mail, billing);

  const signUp = await auth.auth.handler(
    new Request(`${API}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: API },
      body: JSON.stringify({ name: "OAuth Tester", email, password: "correct-horse-battery" }),
    }),
  );
  expect(signUp.status).toBe(200);
  sessionCookie = (signUp.headers.getSetCookie?.() ?? [signUp.headers.get("set-cookie") ?? ""])
    .map((c) => c.split(";")[0])
    .join("; ");

  userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  orgId = `org-oauth-${stamp}`;
  await prisma.organization.create({ data: { id: orgId, name: "OAuth Org", slug: `oauth-${stamp}` } });
  await prisma.member.create({ data: { id: `m-oauth-${stamp}`, organizationId: orgId, userId, role: "owner" } });
});

afterAll(async () => {
  await prisma.oauthApplication.deleteMany({ where: { name: { startsWith: "IT Client" } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("Better Auth mcp plugin on Atrium's schema", () => {
  it("serves discovery metadata that points at the mcp endpoints", async () => {
    const as = (await (await call("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(String(as.authorization_endpoint)).toEndWith("/api/auth/mcp/authorize");
    expect(String(as.token_endpoint)).toEndWith("/api/auth/mcp/token");
    expect(String(as.registration_endpoint)).toEndWith("/api/auth/mcp/register");
    expect(as.code_challenge_methods_supported).toContain("S256");

    const pr = (await (await call("/.well-known/oauth-protected-resource")).json()) as Record<string, unknown>;
    expect(pr.resource).toBe(`${API}/api/mcp`);
    expect((pr.authorization_servers as string[]).length).toBeGreaterThan(0);
  });

  it("completes registration → authorize → consent → token and stores the token row", async () => {
    const clientId = await registerClient("IT Client A");
    const tokens = await authorizeAndExchange(clientId);

    expect(tokens.access_token.length).toBeGreaterThan(20);
    expect(tokens.refresh_token.length).toBeGreaterThan(20);
    expect(tokens.expires_in).toBe(3600);

    const row = await prisma.oauthAccessToken.findUniqueOrThrow({ where: { accessToken: tokens.access_token } });
    expect(row.userId).toBe(userId);
    expect(row.clientId).toBe(clientId);
    expect(row.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("redirects a signed-out authorize request to the login page with the OAuth query intact", async () => {
    const clientId = await registerClient("IT Client B");
    const saved = sessionCookie;
    sessionCookie = "";
    const res = await call(`/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=x&code_challenge=abc&code_challenge_method=S256`);
    sessionCookie = saved;

    expect(res.status).toBe(302);
    const login = new URL(res.headers.get("location")!);
    expect(`${login.origin}${login.pathname}`).toBe(`${WEB}/login`);
    expect(login.searchParams.get("client_id")).toBe(clientId);
    expect(login.searchParams.get("response_type")).toBe("code");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run test:integration`
Expected: the new file FAILS on the first test with a 404 for `/.well-known/oauth-authorization-server` (plugin not registered yet).

- [ ] **Step 4: Register the plugin**

In `apps/api/src/auth/auth.service.ts`:

Add `mcp` to the existing `better-auth/plugins` import (the line that imports `organization` and `magicLink`).

Near the existing `const webUrl = this.config.get("WEB_URL", "http://localhost:3000");` (line ~34), add:

```ts
    const apiUrl: string =
      this.config.get("API_URL") ?? this.config.get("BETTER_AUTH_URL") ?? "http://localhost:3001";
    const mcpOAuthEnabled: boolean = this.config.get("MCP_OAUTH_ENABLED", "true") !== "false";
```

(If the constructor already derives the API URL into a variable, reuse it instead of adding `apiUrl`.)

In the `plugins: [` array, after the `magicLink({ … })` entry, add:

```ts
        ...(mcpOAuthEnabled
          ? [
              mcp({
                loginPage: `${webUrl}/login`,
                resource: `${apiUrl}/api/mcp`,
                oidcConfig: {
                  loginPage: `${webUrl}/login`,
                  consentPage: `${webUrl}/oauth/consent`,
                  allowDynamicClientRegistration: true,
                  requirePKCE: true,
                  scopes: ["openid", "profile", "email", "offline_access"],
                  accessTokenExpiresIn: 3600,
                  refreshTokenExpiresIn: 60 * 60 * 24 * 30,
                },
              }),
            ]
          : []),
```

Add a registration rate limit. If the `betterAuth({ … })` options already contain a `rateLimit` key, merge `customRules` into it; otherwise add alongside `session:`:

```ts
      rateLimit: {
        customRules: {
          "/mcp/register": { window: 3600, max: 10 },
        },
      },
```

In `.env.example`, after the `ALLOW_SIGNUPS` block, add:

```bash
# Lets MCP clients (claude.ai, ChatGPT, Claude Code, Cursor) connect by signing
# in instead of pasting an API key. Requires a public HTTPS URL. API keys work
# regardless of this setting. Default: enabled.
# MCP_OAUTH_ENABLED="true"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test:integration`
Expected: all 3 new tests pass. `bun run test:integration` pushes the schema to `atrium_test` first, so the new tables exist. Also run `cd apps/api && bun test src/auth && bunx tsc --noEmit -p tsconfig.json`: existing auth specs pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/database apps/api/src/auth/auth.service.ts apps/api/test/integration/mcp-oauth.integration.spec.ts .env.example
git commit -m "feat(api): OAuth provider for MCP via Better Auth mcp plugin"
```

---

### Task 2: McpAuthService (token → actor) and grants

**Files:**
- Create: `apps/api/src/mcp-auth/mcp-auth.service.ts`
- Create: `apps/api/src/mcp-auth/mcp-auth.module.ts`
- Test: `apps/api/src/mcp-auth/mcp-auth.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.oauthAccessToken`, `prisma.mcpGrant`, `prisma.oauthApplication`, `prisma.oauthConsent` (Task 1); `Actor` from `../common`.
- Produces:
  - `McpAuthService.resolve(token: string): Promise<(Actor & { oauthClientId: string }) | null>`
  - `McpAuthService.saveGrant(userId: string, clientId: string, organizationId: string): Promise<void>` (throws `ForbiddenException` unless the user is owner/admin of that org, `NotFoundException` for an unknown client)
  - `McpAuthService.getClient(clientId: string): Promise<{ clientId: string; name: string; icon: string | null }>`
  - `McpAuthService.adminOrganizations(userId: string): Promise<{ id: string; name: string }[]>`
  - `McpAuthService.listGrants(userId: string, organizationId: string, role: string): Promise<GrantSummary[]>` where `GrantSummary = { id: string; clientName: string; organizationName: string; userName: string; createdAt: Date; mine: boolean }`
  - `McpAuthService.revokeGrant(id: string, userId: string, organizationId: string, role: string): Promise<void>`
  - `McpAuthModule` exporting `McpAuthService`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/mcp-auth/mcp-auth.service.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { McpAuthService } from "./mcp-auth.service";

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
const user = { id: "u1", name: "Ada" };
const organization = { id: "org1", name: "Acme" };

function build(opts: {
  token?: unknown; grant?: unknown; member?: unknown; app?: unknown;
} = {}) {
  const prisma = {
    oauthAccessToken: {
      findUnique: mock(() => Promise.resolve(opts.token ?? null)),
      deleteMany: mock(() => Promise.resolve({ count: 1 })),
    },
    oauthConsent: { deleteMany: mock(() => Promise.resolve({ count: 1 })) },
    oauthApplication: { findUnique: mock(() => Promise.resolve(opts.app ?? null)) },
    mcpGrant: {
      findUnique: mock(() => Promise.resolve(opts.grant ?? null)),
      findFirst: mock(() => Promise.resolve(opts.grant ?? null)),
      upsert: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
    member: { findFirst: mock(() => Promise.resolve(opts.member ?? null)) },
    $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { service: new McpAuthService(prisma as never), prisma };
}

const token = { accessToken: "tok", userId: "u1", clientId: "c1", accessTokenExpiresAt: future };
const grant = { id: "g1", userId: "u1", clientId: "c1", organizationId: "org1", user, organization };
const owner = { id: "m1", userId: "u1", organizationId: "org1", role: "owner" };

describe("McpAuthService.resolve", () => {
  it("returns the actor for a live token with a grant and an admin-level member", async () => {
    const { service } = build({ token, grant, member: owner });
    const actor = await service.resolve("tok");
    expect(actor?.user.id).toBe("u1");
    expect(actor?.organization.id).toBe("org1");
    expect(actor?.member.role).toBe("owner");
    expect(actor?.oauthClientId).toBe("c1");
  });

  it("returns null for an unknown token", async () => {
    expect(await build().service.resolve("nope")).toBeNull();
  });

  it("returns null for an expired token (the plugin's own lookup does not check)", async () => {
    const { service } = build({ token: { ...token, accessTokenExpiresAt: past }, grant, member: owner });
    expect(await service.resolve("tok")).toBeNull();
  });

  it("returns null when there is no grant, or the user is no longer owner/admin", async () => {
    expect(await build({ token, member: owner }).service.resolve("tok")).toBeNull();
    expect(await build({ token, grant, member: { ...owner, role: "member" } }).service.resolve("tok")).toBeNull();
    expect(await build({ token, grant }).service.resolve("tok")).toBeNull();
  });
});

describe("McpAuthService grants", () => {
  it("saveGrant refuses an org where the user is not owner or admin", async () => {
    const { service, prisma } = build({ app: { clientId: "c1" }, member: { ...owner, role: "member" } });
    await expect(service.saveGrant("u1", "c1", "org1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mcpGrant.upsert).not.toHaveBeenCalled();
  });

  it("saveGrant refuses an unknown client", async () => {
    const { service } = build({ member: owner });
    await expect(service.saveGrant("u1", "ghost", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("saveGrant upserts on (userId, clientId) so re-consent can move the workspace", async () => {
    const { service, prisma } = build({ app: { clientId: "c1" }, member: owner });
    await service.saveGrant("u1", "c1", "org1");
    const args = prisma.mcpGrant.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_clientId: { userId: "u1", clientId: "c1" } });
    expect(args.update).toEqual({ organizationId: "org1" });
  });

  it("revokeGrant deletes the grant, consent, and tokens for that user and client", async () => {
    const { service, prisma } = build({ grant });
    await service.revokeGrant("g1", "u1", "org1", "admin");
    expect(prisma.oauthAccessToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", clientId: "c1" } });
    expect(prisma.oauthConsent.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", clientId: "c1" } });
    expect(prisma.mcpGrant.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });

  it("revokeGrant lets only the owner disconnect someone else's app", async () => {
    const others = { ...grant, userId: "u2" };
    await expect(build({ grant: others }).service.revokeGrant("g1", "u1", "org1", "admin"))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(build({ grant: others }).service.revokeGrant("g1", "u1", "org1", "owner"))
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/mcp-auth`
Expected: FAIL, cannot find module `./mcp-auth.service`.

- [ ] **Step 3: Implement**

Create `apps/api/src/mcp-auth/mcp-auth.service.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "../common";

const GRANT_ROLES: string[] = ["owner", "admin"];

export type ResolvedOAuthToken = Actor & { oauthClientId: string };

export interface GrantSummary {
  id: string;
  clientName: string;
  organizationName: string;
  userName: string;
  createdAt: Date;
  mine: boolean;
}

@Injectable()
export class McpAuthService {
  constructor(private prisma: PrismaService) {}

  /** OAuth access token → actor. Same role rule as API keys; expiry is checked here. */
  async resolve(token: string): Promise<ResolvedOAuthToken | null> {
    const row = await this.prisma.oauthAccessToken.findUnique({ where: { accessToken: token } });
    if (!row || !row.userId) return null;
    if (row.accessTokenExpiresAt.getTime() <= Date.now()) return null;

    const grant = await this.prisma.mcpGrant.findUnique({
      where: { userId_clientId: { userId: row.userId, clientId: row.clientId } },
      include: { user: true, organization: true },
    });
    if (!grant) return null;

    const member = await this.prisma.member.findFirst({
      where: { userId: row.userId, organizationId: grant.organizationId },
    });
    if (!member || !GRANT_ROLES.includes(member.role)) return null;

    return { user: grant.user, organization: grant.organization, member, oauthClientId: row.clientId };
  }

  async getClient(clientId: string): Promise<{ clientId: string; name: string; icon: string | null }> {
    const app = await this.prisma.oauthApplication.findUnique({
      where: { clientId },
      select: { clientId: true, name: true, icon: true },
    });
    if (!app) throw new NotFoundException("Unknown application");
    return app;
  }

  async adminOrganizations(userId: string): Promise<{ id: string; name: string }[]> {
    const memberships = await this.prisma.member.findMany({
      where: { userId, role: { in: GRANT_ROLES } },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return memberships.map((m) => m.organization);
  }

  async saveGrant(userId: string, clientId: string, organizationId: string): Promise<void> {
    const member = await this.prisma.member.findFirst({ where: { userId, organizationId } });
    if (!member || !GRANT_ROLES.includes(member.role)) {
      throw new ForbiddenException("You must be an owner or admin of that workspace");
    }
    await this.getClient(clientId);
    await this.prisma.mcpGrant.upsert({
      where: { userId_clientId: { userId, clientId } },
      create: { userId, clientId, organizationId },
      update: { organizationId },
    });
  }

  /** Admins see their own grants in this workspace; the owner sees everyone's. */
  async listGrants(userId: string, organizationId: string, role: string): Promise<GrantSummary[]> {
    const grants = await this.prisma.mcpGrant.findMany({
      where: { organizationId, ...(role === "owner" ? {} : { userId }) },
      include: { user: { select: { name: true } }, organization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const apps = await this.prisma.oauthApplication.findMany({
      where: { clientId: { in: grants.map((g) => g.clientId) } },
      select: { clientId: true, name: true },
    });
    const names = new Map(apps.map((a) => [a.clientId, a.name]));
    return grants.map((g) => ({
      id: g.id,
      clientName: names.get(g.clientId) ?? "Unknown app",
      organizationName: g.organization.name,
      userName: g.user.name,
      createdAt: g.createdAt,
      mine: g.userId === userId,
    }));
  }

  async revokeGrant(id: string, userId: string, organizationId: string, role: string): Promise<void> {
    const grant = await this.prisma.mcpGrant.findFirst({ where: { id, organizationId } });
    if (!grant) throw new NotFoundException("Connected app not found");
    if (grant.userId !== userId && role !== "owner") {
      throw new ForbiddenException("Only the workspace owner can disconnect another person's app");
    }
    const scope = { userId: grant.userId, clientId: grant.clientId };
    await this.prisma.$transaction([
      this.prisma.oauthAccessToken.deleteMany({ where: scope }),
      this.prisma.oauthConsent.deleteMany({ where: scope }),
      this.prisma.mcpGrant.delete({ where: { id: grant.id } }),
    ]);
  }
}
```

The spec's `build()` mock needs `member.findMany`, `mcpGrant.findMany`, and `oauthApplication.findMany` only if you add tests for `adminOrganizations` / `listGrants`; the tests above do not call them.

Create `apps/api/src/mcp-auth/mcp-auth.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { McpAuthService } from "./mcp-auth.service";

@Module({
  providers: [McpAuthService],
  exports: [McpAuthService],
})
export class McpAuthModule {}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/mcp-auth && bunx tsc --noEmit -p tsconfig.json`
Expected: 9 pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/mcp-auth
git commit -m "feat(api): resolve MCP OAuth tokens to a workspace-bound actor"
```

---

### Task 3: Middleware OAuth branch and the 401 challenge

**Files:**
- Modify: `apps/api/src/auth/session.middleware.ts`
- Modify: `apps/api/src/auth/session.middleware.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/mcp/mcp.service.ts`
- Modify: `apps/api/src/mcp/mcp.service.spec.ts`
- Modify: `apps/api/test/integration/mcp.integration.spec.ts` (constructor arity only)

**Interfaces:**
- Consumes: `McpAuthService.resolve` (Task 2); the bearer branch from the API-keys plan (`extractApiKey`, `applyApiKey`, `CachedSession.apiKeyId`).
- Produces:
  - `SessionMiddleware` constructor becomes `(authService, apiKeys, mcpAuth)`.
  - Non-`atr_` bearer tokens are resolved **only** when the request path is exactly `/api/mcp`.
  - `McpService` constructor gains a 7th parameter `config: ConfigService`; its 401 sends `WWW-Authenticate: Bearer resource_metadata="<API_URL>/.well-known/oauth-protected-resource"` when `MCP_OAUTH_ENABLED` is not `"false"`.

- [ ] **Step 1: Extend the failing tests**

In `apps/api/src/auth/session.middleware.spec.ts`, change `build()` and `req()` to:

```ts
function build(resolveResult: unknown = resolved, oauthResult: unknown = null) {
  const getSession = mock(() => Promise.resolve(null));
  const authService = { auth: { api: { getSession } } };
  const apiKeys = { resolve: mock(() => Promise.resolve(resolveResult)) };
  const mcpAuth = { resolve: mock(() => Promise.resolve(oauthResult)) };
  const mw = new SessionMiddleware(authService as never, apiKeys as never, mcpAuth as never);
  return { mw, getSession, apiKeys, mcpAuth };
}

function req(headers: Record<string, string>, cookies: Record<string, string> = {}, originalUrl = "/api/projects"): Request {
  return { headers, cookies, originalUrl } as unknown as Request;
}
```

Replace the test `"ignores bearer tokens that are not Atrium keys"` with these three:

```ts
  const oauthActor = { ...resolved, apiKeyId: undefined, oauthClientId: "c1" };

  it("resolves an OAuth token on /api/mcp", async () => {
    const { mw, mcpAuth, apiKeys } = build(resolved, oauthActor);
    const r = req({ authorization: "Bearer oauth-token" }, {}, "/api/mcp") as Request & Record<string, any>;
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
      const r = req({ authorization: "Bearer oauth-token" }, {}, url) as Request & Record<string, any>;
      await mw.use(r, {} as Response, mock(() => {}) as unknown as NextFunction);
      expect(r.user).toBeUndefined();
    }
    expect(mcpAuth.resolve).not.toHaveBeenCalled();
  });

  it("treats /api/mcp with a query string as the MCP route", async () => {
    const { mw, mcpAuth } = build(resolved, oauthActor);
    await mw.use(req({ authorization: "Bearer oauth-token" }, {}, "/api/mcp?x=1"), {} as Response, mock(() => {}) as unknown as NextFunction);
    expect(mcpAuth.resolve).toHaveBeenCalledTimes(1);
  });
```

In `apps/api/src/mcp/mcp.service.spec.ts`, change `buildService` and the 401 test:

```ts
function buildService(oauthEnabled = "true"): McpService {
  const stub = {} as never;
  const config = {
    get: (key: string, fallback?: string) =>
      key === "MCP_OAUTH_ENABLED" ? oauthEnabled : key === "API_URL" ? "https://portal.test" : fallback,
  };
  return new McpService(stub, stub, stub, stub, stub, stub, config as never);
}
```

```ts
  it("challenges with resource_metadata when OAuth is enabled", async () => {
    const res = buildRes();
    await buildService().handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toBe(
      'Bearer resource_metadata="https://portal.test/.well-known/oauth-protected-resource"',
    );
  });

  it("falls back to a bare Bearer challenge when OAuth is disabled", async () => {
    const res = buildRes();
    await buildService("false").handle({ headers: {} } as Request, res as unknown as Response);
    expect(res.headers["WWW-Authenticate"]).toBe("Bearer");
  });
```

(Delete the old `"responds 401 with WWW-Authenticate…"` test; these two replace it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/auth/session.middleware.spec.ts src/mcp/mcp.service.spec.ts`
Expected: FAIL. `mcpAuth.resolve` is never called, and the 401 header is the bare `Bearer`.

- [ ] **Step 3: Implement the middleware branch**

In `apps/api/src/auth/session.middleware.ts`:

Add the import and constructor parameter:

```ts
import { McpAuthService } from "../mcp-auth/mcp-auth.service";
// …
  constructor(
    private authService: AuthService,
    private apiKeys: ApiKeysService,
    private mcpAuth: McpAuthService,
  ) {}
```

Add after `extractApiKey`:

```ts
  /** OAuth access tokens are honoured on the MCP endpoint only, never on the REST API. */
  private extractOAuthToken(req: Request): string | undefined {
    if (req.originalUrl.split("?")[0] !== "/api/mcp") return undefined;
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return undefined;
    const token: string = header.slice(7).trim();
    return token && !token.startsWith(API_KEY_PREFIX) ? token : undefined;
  }
```

Replace the whole `applyApiKey` method with `applyBearer`, which both token kinds share:

```ts
  /** Resolves an API key or an MCP OAuth token into the same request fields a cookie session sets. */
  private async applyBearer(
    authReq: Partial<AuthenticatedRequest>,
    token: string,
    kind: "apiKey" | "oauth",
  ): Promise<void> {
    // Cache under the hash so raw tokens are not held in memory.
    const cacheKey: string = `${kind}:${hashApiKey(token)}`;
    let entry: CachedSession | undefined = this.cache.get(cacheKey);
    if (entry && entry.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      entry = undefined;
    }

    if (!entry) {
      const resolved: (Actor & { apiKeyId?: string }) | null =
        kind === "apiKey" ? await this.apiKeys.resolve(token) : await this.mcpAuth.resolve(token);
      if (!resolved) return;
      const now: Date = new Date();
      entry = {
        user: resolved.user,
        organization: resolved.organization,
        member: resolved.member,
        apiKeyId: resolved.apiKeyId,
        session: {
          id: `${kind}:${resolved.user.id}`,
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

Add `Actor` to the type import from `"../common"`. Then replace the API-key block in `use()` with:

```ts
      if (!token) {
        const apiKey: string | undefined = this.extractApiKey(req);
        const oauthToken: string | undefined = apiKey ? undefined : this.extractOAuthToken(req);
        if (apiKey || oauthToken) {
          await this.applyBearer(authReq, (apiKey ?? oauthToken) as string, apiKey ? "apiKey" : "oauth");
          return next();
        }
      }
```

In `apps/api/src/auth/auth.module.ts`, add `McpAuthModule` to `imports`:

```ts
import { McpAuthModule } from "../mcp-auth/mcp-auth.module";
// …
  imports: [MailModule, BillingModule, ApiKeysModule, McpAuthModule],
```

- [ ] **Step 4: Implement the challenge header**

In `apps/api/src/mcp/mcp.service.ts`, add `import { ConfigService } from "@nestjs/config";`, add `private config: ConfigService,` as the last constructor parameter, add this method, and use it in the 401 branch in place of the literal `"Bearer"`:

```ts
  private challenge(): string {
    if (this.config.get("MCP_OAUTH_ENABLED", "true") === "false") return "Bearer";
    const apiUrl: string =
      this.config.get("API_URL") ?? this.config.get("BETTER_AUTH_URL") ?? "http://localhost:3001";
    return `Bearer resource_metadata="${apiUrl}/.well-known/oauth-protected-resource"`;
  }
```

```ts
        .set("WWW-Authenticate", this.challenge())
```

`ConfigModule` is global, so `McpModule` needs no new import.

In `apps/api/test/integration/mcp.integration.spec.ts`, update the two constructors for the new arity:

```ts
  const mcpAuthStub = { resolve: async () => null } as never;
  const middleware = new SessionMiddleware(authStub, apiKeys, mcpAuthStub);
  const configStub = { get: (_k: string, fallback?: string) => fallback } as never;
  const mcp = new McpService(
    new ProjectsService(prisma), unused, unused, new NotesService(prisma), unused, billingStub, configStub,
  );
```

and relax its header assertion to `expect(noKey.headers.get("www-authenticate")).toStartWith("Bearer");`. Make the same relaxation in `e2e/tests/api-keys.e2e.ts` (`expect(res.headers()["www-authenticate"]).toMatch(/^Bearer/);`).

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && bun test src && bunx tsc --noEmit -p tsconfig.json`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test e2e/tests/api-keys.e2e.ts
git commit -m "feat(api): accept MCP OAuth tokens on /api/mcp only"
```

---

### Task 4: Discovery routes

**Files:**
- Create: `apps/api/src/auth/well-known.controller.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `docker/Caddyfile`
- Test: `apps/api/src/auth/well-known.controller.spec.ts`

**Interfaces:**
- Consumes: `authService.auth.api.getMcpOAuthConfig()` and `getMCPProtectedResource()` (Task 1).
- Produces: `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-protected-resource/api/mcp`, `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-authorization-server/api/auth`. 404 when `MCP_OAUTH_ENABLED="false"`.

MCP clients look for metadata at the origin root (RFC 9728 and RFC 8414, including the path-suffixed forms), but the plugin serves it under `/api/auth/.well-known/…`, and Atrium's reverse proxy only forwards `/api/*` to the API. This task closes both gaps.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/well-known.controller.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { WellKnownController } from "./well-known.controller";

function build(enabled: string, withPlugin = true) {
  const api = withPlugin
    ? {
        getMcpOAuthConfig: mock(() => Promise.resolve({ issuer: "https://portal.test" })),
        getMCPProtectedResource: mock(() => Promise.resolve({ resource: "https://portal.test/api/mcp" })),
      }
    : {};
  const config = { get: (_k: string, fallback?: string) => enabled ?? fallback };
  return new WellKnownController({ auth: { api } } as never, config as never);
}

describe("WellKnownController", () => {
  it("returns the plugin's metadata documents", async () => {
    const controller = build("true");
    expect(await controller.authorizationServer()).toEqual({ issuer: "https://portal.test" });
    expect(await controller.protectedResource()).toEqual({ resource: "https://portal.test/api/mcp" });
  });

  it("404s when OAuth is disabled or the plugin is absent", async () => {
    await expect(build("false").authorizationServer()).rejects.toBeInstanceOf(NotFoundException);
    await expect(build("true", false).protectedResource()).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/auth/well-known.controller.spec.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/auth/well-known.controller.ts`:

```ts
import { Controller, Get, Header, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common";
import { AuthService } from "./auth.service";

type MetadataFn = () => Promise<Record<string, unknown> | null>;

/**
 * OAuth discovery documents at the origin root, where MCP clients look for
 * them. The paths are excluded from the global "api" prefix in main.ts.
 */
@Controller(".well-known")
@Public()
@SkipThrottle()
export class WellKnownController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Get(["oauth-authorization-server", "oauth-authorization-server/api/auth"])
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Cache-Control", "public, max-age=300")
  authorizationServer(): Promise<Record<string, unknown>> {
    return this.metadata("getMcpOAuthConfig");
  }

  @Get(["oauth-protected-resource", "oauth-protected-resource/api/mcp"])
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Cache-Control", "public, max-age=300")
  protectedResource(): Promise<Record<string, unknown>> {
    return this.metadata("getMCPProtectedResource");
  }

  private async metadata(name: "getMcpOAuthConfig" | "getMCPProtectedResource"): Promise<Record<string, unknown>> {
    if (this.config.get("MCP_OAUTH_ENABLED", "true") === "false") throw new NotFoundException();
    const api = this.authService.auth.api as unknown as Partial<Record<typeof name, MetadataFn>>;
    const fn: MetadataFn | undefined = api[name];
    const doc: Record<string, unknown> | null = fn ? await fn() : null;
    if (!doc) throw new NotFoundException();
    return doc;
  }
}
```

Add `WellKnownController` to `controllers` in `apps/api/src/auth/auth.module.ts`.

In `apps/api/src/main.ts`, replace `app.setGlobalPrefix("api");` with:

```ts
  // OAuth discovery documents must live at the origin root, not under /api.
  app.setGlobalPrefix("api", {
    exclude: [
      ".well-known/oauth-authorization-server",
      ".well-known/oauth-authorization-server/api/auth",
      ".well-known/oauth-protected-resource",
      ".well-known/oauth-protected-resource/api/mcp",
    ],
  });
```

- [ ] **Step 4: Route the paths to the API in Caddy**

In `docker/Caddyfile`, inside `(common)`, add before the final catch-all `handle {` block:

```
	# OAuth discovery for MCP clients is served by the API, not the web app
	handle /.well-known/oauth-* {
		reverse_proxy 127.0.0.1:3001
	}
```

(`firebase.json` rewrites `**` to the unified container, so it needs no change.)

- [ ] **Step 5: Run the tests and verify against the running API**

Run: `cd apps/api && bun test src/auth && bunx tsc --noEmit -p tsconfig.json`
Expected: pass.

With `bun run dev` running:

```bash
curl -s http://localhost:3001/.well-known/oauth-protected-resource | head -c 300; echo
curl -s http://localhost:3001/.well-known/oauth-authorization-server/api/auth | head -c 300; echo
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/.well-known/oauth-protected-resource
curl -s -i -X POST http://localhost:3001/api/mcp -H 'Content-Type: application/json' -d '{}' | grep -i www-authenticate
```

Expected: two JSON documents (`"resource":"http://localhost:3001/api/mcp"`, and one containing `"authorization_endpoint"`), then `404`, then a `WWW-Authenticate` header containing `resource_metadata=`. If the first two return 404, Nest did not match the `exclude` strings: switch each entry to the object form `{ path: ".well-known/oauth-protected-resource", method: RequestMethod.GET }` (import `RequestMethod` from `@nestjs/common`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth apps/api/src/main.ts docker/Caddyfile
git commit -m "feat(api): serve OAuth discovery documents at the origin root"
```

---

### Task 5: Grants endpoints

**Files:**
- Create: `apps/api/src/mcp-auth/mcp-grants.dto.ts`
- Create: `apps/api/src/mcp-auth/mcp-grants.controller.ts`
- Modify: `apps/api/src/mcp-auth/mcp-auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/mcp-auth/mcp-grants.controller.spec.ts`

**Interfaces:**
- Consumes: `McpAuthService` (Task 2); `UserOnlyAuthGuard` from `../account/user-only-auth.guard` (no dependencies; requires `req.user` but not an active org).
- Produces:
  - `GET /api/mcp-grants/consent-info?clientId=…` → `{ client: { clientId, name, icon }, organizations: { id, name }[] }` (any signed-in user)
  - `POST /api/mcp-grants` body `{ clientId, organizationId }` → 201 empty (any signed-in user; the service enforces owner/admin of the chosen org)
  - `GET /api/mcp-grants` → `GrantSummary[]` (owner/admin of the active org)
  - `DELETE /api/mcp-grants/:id` → 200 empty (owner/admin)

The consent screen can be reached by a user whose active org is not the one they will pick, so its two endpoints use `UserOnlyAuthGuard`, not `AuthGuard`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/mcp-auth/mcp-grants.controller.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { McpConsentController, McpGrantsController } from "./mcp-grants.controller";

function build() {
  const service = {
    getClient: mock(() => Promise.resolve({ clientId: "c1", name: "Claude", icon: null })),
    adminOrganizations: mock(() => Promise.resolve([{ id: "org1", name: "Acme" }])),
    saveGrant: mock(() => Promise.resolve()),
    listGrants: mock(() => Promise.resolve([])),
    revokeGrant: mock(() => Promise.resolve()),
  };
  return {
    service,
    consent: new McpConsentController(service as never),
    grants: new McpGrantsController(service as never),
  };
}

describe("MCP grants controllers", () => {
  it("consent-info returns the client and the workspaces the user may bind", async () => {
    const { consent, service } = build();
    const info = await consent.consentInfo("c1", "u1");
    expect(info).toEqual({
      client: { clientId: "c1", name: "Claude", icon: null },
      organizations: [{ id: "org1", name: "Acme" }],
    });
    expect(service.adminOrganizations).toHaveBeenCalledWith("u1");
  });

  it("consent-info requires clientId", async () => {
    await expect(build().consent.consentInfo("", "u1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("create saves the grant for the signed-in user", async () => {
    const { consent, service } = build();
    await consent.create({ clientId: "c1", organizationId: "org1" }, "u1");
    expect(service.saveGrant).toHaveBeenCalledWith("u1", "c1", "org1");
  });

  it("list and revoke pass the caller's identity and role", async () => {
    const { grants, service } = build();
    await grants.list("u1", "org1", "admin");
    await grants.revoke("g1", "u1", "org1", "owner");
    expect(service.listGrants).toHaveBeenCalledWith("u1", "org1", "admin");
    expect(service.revokeGrant).toHaveBeenCalledWith("g1", "u1", "org1", "owner");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/mcp-auth/mcp-grants.controller.spec.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

Create `apps/api/src/mcp-auth/mcp-grants.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateMcpGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  organizationId!: string;
}
```

Create `apps/api/src/mcp-auth/mcp-grants.controller.ts`:

```ts
import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards,
} from "@nestjs/common";
import { AuthGuard, CurrentMember, CurrentOrg, CurrentUser, Roles, RolesGuard } from "../common";
import { UserOnlyAuthGuard } from "../account/user-only-auth.guard";
import { McpAuthService } from "./mcp-auth.service";
import type { GrantSummary } from "./mcp-auth.service";
import { CreateMcpGrantDto } from "./mcp-grants.dto";

interface ConsentInfo {
  client: { clientId: string; name: string; icon: string | null };
  organizations: { id: string; name: string }[];
}

/** Used by the OAuth consent screen. The user may not have the target org active. */
@Controller("mcp-grants")
@UseGuards(UserOnlyAuthGuard)
export class McpConsentController {
  constructor(private mcpAuth: McpAuthService) {}

  @Get("consent-info")
  async consentInfo(
    @Query("clientId") clientId: string,
    @CurrentUser("id") userId: string,
  ): Promise<ConsentInfo> {
    if (!clientId) throw new BadRequestException("clientId is required");
    const [client, organizations] = await Promise.all([
      this.mcpAuth.getClient(clientId),
      this.mcpAuth.adminOrganizations(userId),
    ]);
    return { client, organizations };
  }

  @Post()
  create(@Body() dto: CreateMcpGrantDto, @CurrentUser("id") userId: string): Promise<void> {
    return this.mcpAuth.saveGrant(userId, dto.clientId, dto.organizationId);
  }
}

/** Used by Settings → API & MCP → Connected apps. */
@Controller("mcp-grants")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class McpGrantsController {
  constructor(private mcpAuth: McpAuthService) {}

  @Get()
  list(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
  ): Promise<GrantSummary[]> {
    return this.mcpAuth.listGrants(userId, orgId, role);
  }

  @Delete(":id")
  revoke(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
  ): Promise<void> {
    return this.mcpAuth.revokeGrant(id, userId, orgId, role);
  }
}
```

In `apps/api/src/mcp-auth/mcp-auth.module.ts`, add `controllers: [McpConsentController, McpGrantsController],` (import both). In `apps/api/src/app.module.ts`, import `McpAuthModule` and add it after `McpModule,`.

Both OAuth tokens and API keys are unable to reach these routes in a harmful way: OAuth tokens are ignored off `/api/mcp` (Task 3), and the `POST` requires the caller to be owner/admin of the org they name.

- [ ] **Step 4: Run the tests and type-check**

Run: `cd apps/api && bun test src/mcp-auth && bunx tsc --noEmit -p tsconfig.json`
Expected: pass.

- [ ] **Step 5: Extend the integration test to the full round trip**

Append to `apps/api/test/integration/mcp-oauth.integration.spec.ts` (add the imports at the top of the file):

```ts
import { McpAuthService } from "../../src/mcp-auth/mcp-auth.service";

describe("OAuth token → MCP actor", () => {
  it("resolves only after a grant exists, and stops after disconnect", async () => {
    const mcpAuth = new McpAuthService(prisma);
    const clientId = await registerClient("IT Client C");
    const tokens = await authorizeAndExchange(clientId);

    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();

    await mcpAuth.saveGrant(userId, clientId, orgId);
    const actor = await mcpAuth.resolve(tokens.access_token);
    expect(actor?.organization.id).toBe(orgId);
    expect(actor?.member.role).toBe("owner");

    const [grant] = await mcpAuth.listGrants(userId, orgId, "owner");
    expect(grant.clientName).toBe("IT Client C");
    await mcpAuth.revokeGrant(grant.id, userId, orgId, "owner");

    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
    expect(await prisma.oauthAccessToken.count({ where: { clientId, userId } })).toBe(0);
    expect(await prisma.oauthConsent.count({ where: { clientId, userId } })).toBe(0);
  });

  it("rejects an expired access token", async () => {
    const mcpAuth = new McpAuthService(prisma);
    const clientId = await registerClient("IT Client D");
    const tokens = await authorizeAndExchange(clientId);
    await mcpAuth.saveGrant(userId, clientId, orgId);
    await prisma.oauthAccessToken.update({
      where: { accessToken: tokens.access_token },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
  });

  it("issues a fresh access token from a refresh token", async () => {
    const clientId = await registerClient("IT Client E");
    const tokens = await authorizeAndExchange(clientId);
    const res = await call("/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const refreshed = (await res.json()) as { access_token: string };
    expect(refreshed.access_token).not.toBe(tokens.access_token);
  });
});
```

Run: `bun run test:integration`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test/integration/mcp-oauth.integration.spec.ts
git commit -m "feat(api): MCP grant endpoints for consent and connected apps"
```

---

### Task 6: Resume OAuth after login

**Files:**
- Modify: `apps/web/src/app/(auth)/login/login-form.tsx`
- Create: `apps/web/src/lib/oauth-resume.ts`
- Test: `apps/web/src/lib/oauth-resume.test.ts`

**Interfaces:**
- Produces: `oauthResumeUrl(search: string, apiUrl: string): string | null`. Returns `<apiUrl>/api/auth/mcp/authorize?<search>` when `search` contains both `client_id` and `response_type`, else `null`.

**Why this shape.** When a signed-out user starts an OAuth flow, the plugin redirects to `/login?<original OAuth query>` and sets a signed `oidc_login_prompt` cookie. Its after-hook then answers the *sign-in request itself* with a 302 to the consent page (or straight to the client's callback). The login form signs in with `fetch`, which would silently follow that redirect: cross-origin to the client's callback it fails on CORS and burns the authorization code. So for OAuth logins the form must not follow the redirect. It signs in with `redirect: "manual"` (the session cookie on the 302 is still stored), then does a top-level navigation back to the authorize endpoint with the original query, which now finds a session and proceeds normally. Magic-link sign-in needs no change: its verify step is already a top-level navigation, so the plugin's redirect just works.

- [ ] **Step 1: Write the failing test**

The web app's unit tests use `bun:test` and sit next to the code (like `apps/web/src/lib/clipboard.test.ts`). Create `apps/web/src/lib/oauth-resume.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { oauthResumeUrl } from "./oauth-resume";

describe("oauthResumeUrl", () => {
  it("returns null for a normal login", () => {
    expect(oauthResumeUrl("", "https://api.test")).toBeNull();
    expect(oauthResumeUrl("?redirect=/dashboard", "https://api.test")).toBeNull();
    expect(oauthResumeUrl("?client_id=abc", "https://api.test")).toBeNull();
  });

  it("rebuilds the authorize URL with the original query", () => {
    const search = "?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&code_challenge=x&code_challenge_method=S256";
    expect(oauthResumeUrl(search, "https://api.test")).toBe(
      `https://api.test/api/auth/mcp/authorize${search}`,
    );
  });

  it("works with a same-origin API (empty apiUrl)", () => {
    expect(oauthResumeUrl("?response_type=code&client_id=abc", "")).toBe(
      "/api/auth/mcp/authorize?response_type=code&client_id=abc",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun test src/lib/oauth-resume.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/oauth-resume.ts`:

```ts
/**
 * When /login was reached from an MCP OAuth flow, the original authorize
 * query is in the URL. After sign-in we send the browser back to the
 * authorize endpoint with it, as a top-level navigation.
 */
export function oauthResumeUrl(search: string, apiUrl: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get("client_id") || !params.get("response_type")) return null;
  // Keep the query byte-for-byte as the authorization server issued it.
  return `${apiUrl}/api/auth/mcp/authorize?${search.replace(/^\?/, "")}`;
}
```

In `apps/web/src/app/(auth)/login/login-form.tsx`:

Add the import:

```ts
import { oauthResumeUrl } from "@/lib/oauth-resume";
```

Replace the sign-in `fetch` call and the code through the final redirect inside `handleSubmit`'s `try` with:

```ts
      const resumeUrl: string | null = oauthResumeUrl(window.location.search, API_URL);

      const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
        // In an OAuth flow Better Auth answers a successful sign-in with a 302
        // to the consent page or the client's callback. Don't follow it from
        // fetch; re-enter the flow with a real navigation below.
        redirect: resumeUrl ? "manual" : "follow",
      });

      const signedIn: boolean = res.ok || (resumeUrl !== null && res.type === "opaqueredirect");
      if (!signedIn) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message || "Invalid credentials");
      }

      // Without a success counterpart, login_failed is uninterpretable: there
      // is no denominator to compute a success rate from.
      track("login_succeeded", { branded: Boolean(orgName), oauth: Boolean(resumeUrl) });

      setRedirecting(true);
      window.location.href = resumeUrl ?? (await setActiveOrgAndRedirect("/portal/projects"));
```

If `track`'s type rejects the extra `oauth` property, drop it rather than widening the type.

- [ ] **Step 4: Run the tests, lint, and type-check**

Run: `cd apps/web && bun test src/lib && bunx tsc --noEmit && bun run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/oauth-resume.ts apps/web/src/lib/oauth-resume.test.ts "apps/web/src/app/(auth)/login/login-form.tsx"
git commit -m "feat(web): resume MCP OAuth flow after login"
```

---

### Task 7: Consent page

**Files:**
- Create: `apps/web/src/app/(auth)/oauth/consent/page.tsx`
- Create: `apps/web/src/app/(auth)/oauth/consent/consent-form.tsx`

**Interfaces:**
- Consumes: query params `consent_code`, `client_id`, `scope` (set by the plugin); `GET /api/mcp-grants/consent-info`, `POST /api/mcp-grants` (Task 5); `POST /api/auth/oauth2/consent` body `{ accept: boolean, consent_code: string }` → `{ redirectURI: string }`.
- Produces: page at `/oauth/consent` with heading `Connect <client name> to Atrium`, a `<select aria-label="Workspace">` when there is more than one workspace, and buttons "Allow" and "Deny".

- [ ] **Step 1: Create the form**

Create `apps/web/src/app/(auth)/oauth/consent/consent-form.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface ConsentInfo {
  client: { clientId: string; name: string; icon: string | null };
  organizations: { id: string; name: string }[];
}

interface ConsentFormProps {
  clientId: string;
  consentCode: string;
}

export function ConsentForm({ clientId, consentCode }: ConsentFormProps): React.ReactElement {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [organizationId, setOrganizationId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<ConsentInfo>(`/mcp-grants/consent-info?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => {
        setInfo(data);
        if (data.organizations.length > 0) setOrganizationId(data.organizations[0].id);
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(err instanceof Error ? err.message : "Could not load this request");
      });
  }, [clientId]);

  const respond = async (accept: boolean): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (accept) {
        await apiFetch("/mcp-grants", {
          method: "POST",
          body: JSON.stringify({ clientId, organizationId }),
        });
      }
      const res = await fetch(`${API_URL}/api/auth/oauth2/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirectURI?: string; message?: string };
      if (!res.ok || !data.redirectURI) throw new Error(data.message || "Could not complete the request");
      window.location.href = data.redirectURI;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  if (error && !info) return <p className="text-sm text-red-600">{error}</p>;
  if (!info) return <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>;

  const canAllow: boolean = info.organizations.length > 0;
  const workspaceName: string =
    info.organizations.find((o) => o.id === organizationId)?.name ?? "your workspace";

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Connect {info.client.name} to Atrium</h1>

      {canAllow ? (
        <>
          <p className="text-sm text-[var(--muted-foreground)]">
            <strong>{info.client.name}</strong> will be able to view and manage projects, clients, tasks,
            updates, and notes in <strong>{workspaceName}</strong>, acting as you. You can disconnect it
            at any time in Settings → API &amp; MCP.
          </p>

          {info.organizations.length > 1 && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Workspace</span>
              <select
                aria-label="Workspace"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
              >
                {info.organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Only workspace owners and admins can connect AI assistants. Your account is not an owner or
          admin of any workspace.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {canAllow && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void respond(true)}
            className="flex-1 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Allow
          </button>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void respond(false)}
          className="flex-1 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

Create `apps/web/src/app/(auth)/oauth/consent/page.tsx`:

```tsx
import { ConsentForm } from "./consent-form";

interface ConsentPageProps {
  searchParams: Promise<{ client_id?: string; consent_code?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps): Promise<React.ReactElement> {
  const { client_id: clientId, consent_code: consentCode } = await searchParams;

  if (!clientId || !consentCode) {
    return (
      <p className="text-sm text-red-600">
        This link is incomplete. Start the connection again from your AI assistant.
      </p>
    );
  }
  return <ConsentForm clientId={clientId} consentCode={consentCode} />;
}
```

Open `apps/web/src/app/(auth)/layout.tsx` and `login/page.tsx`: if the login page wraps its form in a card container that the layout does not provide, wrap `ConsentForm` and the error paragraph in the same container so the page matches `/login`.

- [ ] **Step 3: Check it in a browser**

With `bun run dev` running and signed in as an owner, register a client and open an authorize URL:

```bash
CID=$(curl -s -X POST http://localhost:3001/api/auth/mcp/register -H 'Content-Type: application/json' \
  -d '{"client_name":"Manual Test","redirect_uris":["http://localhost:9999/callback"],"token_endpoint_auth_method":"none"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["client_id"])')
echo "http://localhost:3001/api/auth/mcp/authorize?response_type=code&client_id=$CID&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback&scope=openid&state=abc&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
```

Open the printed URL. Expected: the consent page shows "Connect Manual Test to Atrium"; **Allow** lands on `http://localhost:9999/callback?code=…&state=abc` (the browser shows a connection error, which is fine: nothing listens there). Repeat in a private window while signed out: you land on `/login?...`, and after signing in you arrive at the same consent page. Run `cd apps/web && bunx tsc --noEmit && bun run lint`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(auth)/oauth"
git commit -m "feat(web): OAuth consent page for MCP clients"
```

---

### Task 8: Connected apps in settings, and cleanup of unused clients

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connected-apps-section.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connect-card.tsx`
- Create: `apps/api/src/mcp-auth/oauth-cleanup.task.ts`
- Modify: `apps/api/src/mcp-auth/mcp-auth.module.ts`
- Modify: `apps/api/src/health.controller.ts` (`GET /api/health/config`)
- Test: `apps/api/src/mcp-auth/oauth-cleanup.task.spec.ts`

**Interfaces:**
- Consumes: `GET /api/mcp-grants`, `DELETE /api/mcp-grants/:id` (Task 5).
- Produces: section with heading "Connected apps", per-row "Disconnect" buttons, toast "App disconnected"; `mcpOAuthEnabled: boolean` on the public `GET /api/health/config` response; a nightly prune of dynamic clients older than 7 days with no tokens and no grants.

- [ ] **Step 1: Expose the flag to the web app**

In `apps/api/src/health.controller.ts`, extend `getConfig()`:

```ts
    return {
      billingEnabled: this.config.get("BILLING_ENABLED") === "true",
      signupEnabled: this.config.get("ALLOW_SIGNUPS") !== "false",
      mcpOAuthEnabled: this.config.get("MCP_OAUTH_ENABLED", "true") !== "false",
    };
```

Run `grep -rn "signupEnabled" apps/api/src --include=*.spec.ts e2e/tests`; any test asserting the exact response object gets the new field added.

- [ ] **Step 2: Write the failing cleanup test**

Create `apps/api/src/mcp-auth/oauth-cleanup.task.spec.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { OAuthCleanupTask } from "./oauth-cleanup.task";

describe("OAuthCleanupTask", () => {
  it("prunes only old clients with no tokens and no grants", async () => {
    const prisma = {
      mcpGrant: { findMany: mock(() => Promise.resolve([{ clientId: "kept-by-grant" }])) },
      oauthApplication: { deleteMany: mock(() => Promise.resolve({ count: 2 })) },
    };
    await new OAuthCleanupTask(prisma as never).pruneUnusedClients();

    const where = prisma.oauthApplication.deleteMany.mock.calls[0][0].where;
    expect(where.accessTokens).toEqual({ none: {} });
    expect(where.clientId).toEqual({ notIn: ["kept-by-grant"] });
    const ageMs: number = Date.now() - where.createdAt.lt.getTime();
    expect(Math.round(ageMs / 86_400_000)).toBe(7);
  });
});
```

Run: `cd apps/api && bun test src/mcp-auth/oauth-cleanup.task.spec.ts` → FAIL, module not found.

- [ ] **Step 3: Implement the cleanup task**

Create `apps/api/src/mcp-auth/oauth-cleanup.task.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

const UNUSED_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Dynamic client registration is open, so abandoned registrations are pruned. */
@Injectable()
export class OAuthCleanupTask {
  private readonly logger = new Logger(OAuthCleanupTask.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneUnusedClients(): Promise<void> {
    try {
      const granted = await this.prisma.mcpGrant.findMany({ select: { clientId: true }, distinct: ["clientId"] });
      const result = await this.prisma.oauthApplication.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - UNUSED_CLIENT_TTL_MS) },
          accessTokens: { none: {} },
          clientId: { notIn: granted.map((g) => g.clientId) },
        },
      });
      if (result.count > 0) this.logger.log(`Pruned ${result.count} unused OAuth client(s)`);
    } catch (err) {
      this.logger.error("Failed to prune OAuth clients", err instanceof Error ? err.stack : String(err));
    }
  }
}
```

In `mcp-auth.module.ts`, add `OAuthCleanupTask` to `providers` and `imports: [ScheduleModule.forRoot()],` (import `ScheduleModule` from `@nestjs/schedule`). This repo registers the scheduler per feature module; see `documents.module.ts`.

Run: `cd apps/api && bun test src/mcp-auth` → pass.

- [ ] **Step 4: Create the Connected apps section**

Create `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/connected-apps-section.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Plug, Unplug } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";

interface GrantSummary {
  id: string;
  clientName: string;
  organizationName: string;
  userName: string;
  createdAt: string;
  mine: boolean;
}

export function ConnectedAppsSection(): React.ReactElement {
  const [grants, setGrants] = useState<GrantSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { success, error: showError } = useToast();
  const confirm = useConfirm();

  const load = (): void => {
    apiFetch<GrantSummary[]>("/mcp-grants")
      .then((data) => setGrants(data))
      .catch((err: unknown) => {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to load connected apps");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = async (grant: GrantSummary): Promise<void> => {
    const ok = await confirm({
      title: "Disconnect app",
      message: `Disconnect "${grant.clientName}"? It will lose access immediately and must sign in again to reconnect.`,
      confirmLabel: "Disconnect",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/mcp-grants/${grant.id}`, { method: "DELETE" });
      success("App disconnected");
      load();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to disconnect app");
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border)] p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Plug size={18} /> Connected apps
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          AI assistants that were connected by signing in. Each acts as the person who connected it.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No connected apps.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--muted-foreground)]">
            <tr>
              <th className="py-2 font-medium">App</th>
              <th className="py-2 font-medium">Connected by</th>
              <th className="py-2 font-medium">Connected</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.id} className="border-t border-[var(--border)]">
                <td className="py-2">{grant.clientName}</td>
                <td className="py-2">{grant.mine ? "You" : grant.userName}</td>
                <td className="py-2">{new Date(grant.createdAt).toLocaleDateString()}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void disconnect(grant)}
                    className="inline-flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <Unplug size={14} /> Disconnect
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

- [ ] **Step 5: Wire the page and lead the connect card with login**

Replace `apps/web/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx` with a client page that reads the flag:

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ApiKeysSection } from "./api-keys-section";
import { ConnectCard } from "./connect-card";
import { ConnectedAppsSection } from "./connected-apps-section";

export default function ApiKeysPage(): React.ReactElement {
  const [oauthEnabled, setOauthEnabled] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<{ mcpOAuthEnabled?: boolean }>("/health/config")
      .then((cfg) => setOauthEnabled(Boolean(cfg.mcpOAuthEnabled)))
      .catch((err: unknown) => console.error(err));
  }, []);

  return (
    <div className="space-y-6">
      <ConnectCard oauthEnabled={oauthEnabled} />
      {oauthEnabled && <ConnectedAppsSection />}
      <ApiKeysSection />
    </div>
  );
}
```

In `connect-card.tsx`, change the signature to `export function ConnectCard({ oauthEnabled }: { oauthEnabled: boolean }): React.ReactElement` and replace the descriptive `<p>` under the heading with:

```tsx
        {oauthEnabled ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            <strong>Sign in to connect:</strong> in Claude, ChatGPT, Claude Code, or Cursor, add a custom
            MCP connector with the URL below. You will be sent here to sign in and approve. Needs a public
            HTTPS address. <strong>For agents and scripts,</strong> or a server on your local network,
            use an API key with the snippets below.
          </p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Atrium speaks the Model Context Protocol (MCP). Point any MCP client at this URL and send an
            API key as a bearer token. Works with Claude, OpenAI, local models, and agent frameworks.
          </p>
        )}
```

Run: `cd apps/web && bunx tsc --noEmit && bun run lint`. Then re-run `bunx playwright test --config=e2e/playwright.config.ts e2e/tests/api-keys.e2e.ts` to confirm the reordering did not break the key tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/web/src
git commit -m "feat: connected apps settings and cleanup of unused OAuth clients"
```

---

### Task 9: E2E

**Files:**
- Create: `e2e/tests/mcp-oauth.e2e.ts`

**Interfaces:**
- Consumes: the whole flow. The default Playwright context is signed in as an owner (`storageState`). `POST /api/onboarding/signup` with `{ name, email, password, orgName }` creates a fresh owner account (same call `e2e/global-setup.ts` makes).

- [ ] **Step 1: Write the test**

Create `e2e/tests/mcp-oauth.e2e.ts`:

```ts
import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { createHash, randomBytes } from "crypto";

const API_URL = "http://localhost:3001";
const REDIRECT_URI = "http://localhost:9999/callback";

interface Flow { clientId: string; authorizeUrl: string; verifier: string }

async function startFlow(request: APIRequestContext, name: string): Promise<Flow> {
  const reg = await request.post(`${API_URL}/api/auth/mcp/register`, {
    data: { client_name: name, redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" },
  });
  expect(reg.ok()).toBeTruthy();
  const clientId: string = (await reg.json()).client_id;
  const verifier: string = randomBytes(32).toString("base64url");
  const challenge: string = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access", state: "e2e",
    code_challenge: challenge, code_challenge_method: "S256",
  });
  return { clientId, verifier, authorizeUrl: `${API_URL}/api/auth/mcp/authorize?${query}` };
}

/** Nothing listens on the redirect URI, so capture the navigation instead of loading it. */
async function captureCallback(page: Page, action: () => Promise<void>): Promise<URL> {
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().startsWith(REDIRECT_URI), { timeout: 15_000 }),
    action(),
  ]);
  return new URL(request.url());
}

async function exchange(request: APIRequestContext, flow: Flow, code: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/mcp/token`, {
    form: {
      grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
      client_id: flow.clientId, code_verifier: flow.verifier,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).access_token;
}

const INITIALIZE = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } },
};

test.describe("MCP OAuth login", () => {
  test("discovery documents are served at the origin root", async ({ request }) => {
    const pr = await request.get(`${API_URL}/.well-known/oauth-protected-resource`);
    expect((await pr.json()).resource).toContain("/api/mcp");
    const as = await request.get(`${API_URL}/.well-known/oauth-authorization-server`);
    expect((await as.json()).registration_endpoint).toContain("/api/auth/mcp/register");
  });

  test("consent → token → MCP call → disconnect", async ({ page, request, playwright }) => {
    const name = `E2E App ${Date.now()}`;
    const flow = await startFlow(request, name);

    await page.goto(flow.authorizeUrl);
    await expect(page).toHaveURL(/\/oauth\/consent/);
    await expect(page.getByRole("heading", { name: `Connect ${name} to Atrium` })).toBeVisible();

    const callback = await captureCallback(page, () => page.getByRole("button", { name: "Allow" }).click());
    expect(callback.searchParams.get("state")).toBe("e2e");
    const token = await exchange(request, flow, callback.searchParams.get("code")!);

    const bare = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const ok = await bare.post(`${API_URL}/api/mcp`, { headers, data: INITIALIZE });
    expect(ok.status()).toBe(200);

    // The OAuth token must not work on the REST API
    const rest = await bare.get(`${API_URL}/api/projects`, { headers });
    expect(rest.status()).toBe(401);

    // Listed under Connected apps; disconnecting kills the token
    await page.goto("/dashboard/settings/api-keys");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: /disconnect/i }).click();
    await page.getByRole("button", { name: "Disconnect" }).last().click();
    await expect(page.getByText(/app disconnected/i)).toBeVisible({ timeout: 5000 });

    await expect
      .poll(async () => (await bare.post(`${API_URL}/api/mcp`, { headers, data: INITIALIZE })).status(),
        { timeout: 40_000, intervals: [2_000] })
      .toBe(401);
    await bare.dispose();
  });

  test("Deny returns access_denied to the client", async ({ page, request }) => {
    const flow = await startFlow(request, `E2E Deny ${Date.now()}`);
    await page.goto(flow.authorizeUrl);
    const callback = await captureCallback(page, () => page.getByRole("button", { name: "Deny" }).click());
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("code")).toBeNull();
  });

  test("a signed-out user is sent to login and lands on consent after signing in", async ({ browser, request }) => {
    const name = `E2E Login ${Date.now()}`;
    const flow = await startFlow(request, name);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto(flow.authorizeUrl);
    await expect(page).toHaveURL(/\/login\?.*client_id=/);

    // A dedicated account, created the way e2e/global-setup.ts creates the main one.
    const email = `oauth-login-${Date.now()}@test.local`;
    const password = "OAuthLogin123!";
    const signup = await request.post(`${API_URL}/api/onboarding/signup`, {
      data: { name: "OAuth Login", email, password, orgName: "OAuth Login Org" },
    });
    expect(signup.ok()).toBeTruthy();

    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    await expect(page).toHaveURL(/\/oauth\/consent/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: `Connect ${name} to Atrium` })).toBeVisible();
    await context.close();
  });
});
```

The signup request in the last test runs in the default (signed-in) request context; the browser context used for the login itself is separate and starts with no cookies, so it is genuinely signed out.

- [ ] **Step 2: Run it**

Run: `bunx playwright test --config=e2e/playwright.config.ts e2e/tests/mcp-oauth.e2e.ts`
Expected: 4 passed. The last test is the real check on Task 6: if it ends up anywhere other than `/oauth/consent`, debug with `--headed` and watch the network tab for the sign-in response.

- [ ] **Step 3: Commit**

```bash
git add e2e
git commit -m "test(e2e): MCP OAuth login flow"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/mcp.md`, `docs/configuration.md`, `docs/security.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/mcp.md`**

Change the intro bullets to:

```markdown
- **Endpoint:** `https://<your-atrium-host>/api/mcp` (Streamable HTTP, stateless)
- **Auth:** sign in with your Atrium account (OAuth), or send an API key as `Authorization: Bearer atr_…`
```

Insert a new section before "## 1. Create an API key" and renumber the existing two sections to "Option B":

````markdown
## Option A: Connect by signing in

Best for claude.ai, ChatGPT, Claude Desktop, Claude Code, and Cursor. Requires your
Atrium instance to be reachable at a public **HTTPS** address.

1. In your AI client, add a custom MCP connector (or server) and paste your MCP URL:
   `https://portal.example.com/api/mcp`. Leave any client ID / secret fields empty.
2. The client opens Atrium. Sign in if asked.
3. Review the request, pick the workspace if you have more than one, and click **Allow**.

Claude Code: `claude mcp add --transport http atrium https://portal.example.com/api/mcp`,
then run `/mcp` and choose **Authenticate**.

The assistant acts as you in the workspace you picked. Only owners and admins can
connect. See and disconnect assistants under **Settings → API & MCP → Connected apps**;
disconnecting takes effect within 30 seconds. To move an assistant to a different
workspace, disconnect it and connect again.

**When to use an API key instead:** headless agents and scripts, the Anthropic or OpenAI
APIs, n8n, local-model front ends, and any instance on plain HTTP or a private network.

To turn sign-in connections off entirely, set `MCP_OAUTH_ENABLED="false"`.
````

- [ ] **Step 2: The other docs**

- `docs/configuration.md`: add a row/entry for `MCP_OAUTH_ENABLED` (default `true`): "Allow MCP clients to connect by signing in (OAuth). Requires a public HTTPS URL. API keys work regardless."
- `docs/security.md`, add:

```markdown
## MCP OAuth

Atrium acts as an OAuth 2.1 authorization server for MCP clients (Better Auth `mcp`
plugin): PKCE is required, redirect URIs are exact-match, access tokens last 1 hour and
refresh tokens 30 days. Dynamic client registration is open, as the MCP spec expects; it
is rate limited to 10 per hour per IP and unused registrations are pruned after 7 days.

OAuth access tokens are honoured **only** on `POST /api/mcp`. They cannot call the REST
API or create API keys. Each grant is bound to one workspace, chosen on the consent
screen, and resolves only while the user is an owner or admin there. The plugin stores
access and refresh tokens unhashed; the short lifetime and the single-endpoint rule bound
the impact of a database leak. Disconnecting an app deletes its tokens, consent, and grant.
```

- `README.md`: extend the MCP feature line with "connect by signing in or with an API key".
- `CLAUDE.md`, API Structure list, add: `- **MCP auth**: `mcp-auth/` -- OAuth tokens (Better Auth `mcp` plugin) → workspace-bound actor via `McpGrant`; honoured only on `/api/mcp`. Kept out of `mcp/` to avoid a module cycle with `AuthModule``

- [ ] **Step 3: Full verification**

Run: `bun run lint && bun run test && bun run build && bun run test:integration && bun run test:e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs README.md CLAUDE.md
git commit -m "docs: connect MCP clients by signing in"
```
