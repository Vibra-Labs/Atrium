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
const billing = {
  initializeFreePlan: async () => undefined,
} as unknown as BillingService;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", API);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return auth.auth.handler(
    new Request(`${API}/api/auth${path}`, {
      ...init,
      headers,
      redirect: "manual",
    }),
  );
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
  // The plugin answers dynamic registration with 201 Created (RFC 7591).
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/**
 * Runs authorize → consent → token and returns the token response.
 *
 * `prompt=consent` is not optional: authorize.mjs only redirects to the
 * consent page (and only preserves `state`) when the request asks for it.
 * Without it the plugin bounces straight back to the client's redirect_uri
 * with a code and the consent screen never runs.
 */
export async function authorizeAndExchange(clientId: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const verifier: string = randomBytes(32).toString("base64url");
  const challenge: string = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state: "st8",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authorize = await call(`/mcp/authorize?${query}`);
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get("location")!);
  expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(
    `${WEB}/oauth/consent`,
  );
  expect(consentUrl.searchParams.get("client_id")).toBe(clientId);
  expect(consentUrl.searchParams.get("scope")).toBe(
    "openid profile email offline_access",
  );
  const consentCode: string = consentUrl.searchParams.get("consent_code")!;

  const consent = await call("/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept: true, consent_code: consentCode }),
  });
  expect(consent.status).toBe(200);
  const callback = new URL(
    ((await consent.json()) as { redirectURI: string }).redirectURI,
  );
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
  return (await token.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
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
      body: JSON.stringify({
        name: "OAuth Tester",
        email,
        password: "correct-horse-battery",
      }),
    }),
  );
  expect(signUp.status).toBe(200);
  sessionCookie = (
    signUp.headers.getSetCookie?.() ?? [signUp.headers.get("set-cookie") ?? ""]
  )
    .map((c) => c.split(";")[0])
    .join("; ");

  userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  orgId = `org-oauth-${stamp}`;
  await prisma.organization.create({
    data: { id: orgId, name: "OAuth Org", slug: `oauth-${stamp}` },
  });
  await prisma.member.create({
    data: {
      id: `m-oauth-${stamp}`,
      organizationId: orgId,
      userId,
      role: "owner",
    },
  });
});

afterAll(async () => {
  await prisma.oauthApplication.deleteMany({
    where: { name: { startsWith: "IT Client" } },
  });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("Better Auth mcp plugin on Atrium's schema", () => {
  it("serves discovery metadata that points at the mcp endpoints", async () => {
    const as = (await (
      await call("/.well-known/oauth-authorization-server")
    ).json()) as Record<string, unknown>;
    expect(String(as.authorization_endpoint)).toEndWith(
      "/api/auth/mcp/authorize",
    );
    expect(String(as.token_endpoint)).toEndWith("/api/auth/mcp/token");
    expect(String(as.registration_endpoint)).toEndWith(
      "/api/auth/mcp/register",
    );
    expect(as.code_challenge_methods_supported).toContain("S256");

    const pr = (await (
      await call("/.well-known/oauth-protected-resource")
    ).json()) as Record<string, unknown>;
    expect(pr.resource).toBe(`${API}/api/mcp`);
    expect((pr.authorization_servers as string[]).length).toBeGreaterThan(0);
  });

  it("completes registration → authorize → consent → token and stores the token row", async () => {
    const clientId = await registerClient("IT Client A");
    const tokens = await authorizeAndExchange(clientId);

    expect(tokens.access_token.length).toBeGreaterThan(20);
    expect(tokens.refresh_token.length).toBeGreaterThan(20);
    expect(tokens.expires_in).toBe(3600);

    const row = await prisma.oauthAccessToken.findUniqueOrThrow({
      where: { accessToken: tokens.access_token },
    });
    expect(row.userId).toBe(userId);
    expect(row.clientId).toBe(clientId);
    expect(row.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());

    // The consent decision is recorded so a later task can skip re-prompting.
    const consent = await prisma.oauthConsent.findFirstOrThrow({
      where: { clientId, userId },
    });
    expect(consent.consentGiven).toBe(true);
  });

  it("redirects a signed-out authorize request to the login page with the OAuth query intact", async () => {
    const clientId = await registerClient("IT Client B");
    const saved = sessionCookie;
    sessionCookie = "";
    const res = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=x&prompt=consent&code_challenge=abc&code_challenge_method=S256`,
    );
    sessionCookie = saved;

    expect(res.status).toBe(302);
    const login = new URL(res.headers.get("location")!);
    expect(`${login.origin}${login.pathname}`).toBe(`${WEB}/login`);
    expect(login.searchParams.get("client_id")).toBe(clientId);
    expect(login.searchParams.get("response_type")).toBe("code");
    // The whole request is stashed in a signed cookie so the post-login hook
    // can resume authorize without the login page having to replay it.
    expect(res.headers.get("set-cookie")).toContain("oidc_login_prompt");
  });
});
