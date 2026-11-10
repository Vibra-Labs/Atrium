/**
 * Proves Better Auth's MCP plugin (@better-auth/mcp) works end to end against
 * Atrium's Prisma schema: dynamic registration → authorize (signed in) →
 * consent → token. Everything downstream (grants, the middleware branch, the
 * consent page) assumes this flow, so it is asserted against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHash, randomBytes } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { assertDisposableDatabase } from "./guard";
import { AuthService } from "../../src/auth/auth.service";
import { WellKnownController } from "../../src/auth/well-known.controller";
import { PrismaService } from "../../src/prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { MailService } from "../../src/mail/mail.service";
import type { BillingService } from "../../src/billing/billing.service";
import { McpAuthService } from "../../src/mcp-auth/mcp-auth.service";
import { McpConsentController } from "../../src/mcp-auth/mcp-grants.controller";
import { OAuthCleanupTask } from "../../src/mcp-auth/oauth-cleanup.task";
import { promoteGrantOnConsent, readSignedConsentRequest } from "../../src/mcp-auth/consent-hooks";
import { ClientsService } from "../../src/clients/clients.service";
import { hashOAuthToken } from "../../src/common";
import type { AuthenticatedRequest } from "../../src/common";
import { oauthResumeUrl } from "../../../web/src/lib/oauth-resume";

const API = "http://localhost:3001";
const WEB = "http://localhost:3000";
const SECRET: string = "x".repeat(32);
const REDIRECT_URI = "http://localhost:9999/callback";
const stamp = `${Date.now()}`;
const email = `oauth-${stamp}@test.com`;
/** A second account, to prove a parked choice belongs to the user who made it. */
const otherEmail = `oauth-other-${stamp}@test.com`;
const anyRequest = {} as AuthenticatedRequest;

let prisma: PrismaService;
let auth: AuthService;
let sessionCookie: string;
let otherSessionCookie: string;
let userId: string;
let otherUserId: string;
let orgId: string;

function configWith(overrides: Record<string, string>): ConfigService {
  const values: Record<string, string> = {
    WEB_URL: WEB,
    API_URL: API,
    MCP_OAUTH_ENABLED: "true",
    BETTER_AUTH_SECRET: SECRET,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`Missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

const config: ConfigService = configWith({});
const mail = { send: async () => undefined } as unknown as MailService;
const billing = { initializeFreePlan: async () => undefined } as unknown as BillingService;

function call(path: string, init: RequestInit = {}, cookie: string = sessionCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", API);
  if (cookie) headers.set("Cookie", cookie);
  return auth.auth.handler(
    new Request(`${API}/api/auth${path}`, { ...init, headers, redirect: "manual" }),
  );
}

function mcpAuthService(): McpAuthService {
  return new McpAuthService(prisma, config);
}

function consentController(): McpConsentController {
  return new McpConsentController(mcpAuthService());
}

/** Names are stamped per run so cleanup can delete exactly this run's rows. */
function clientName(name: string): string {
  return `${name} ${stamp}`;
}

/** Posts a raw registration request, without asserting on the outcome. */
function postRegistration(name: string, redirectUris: unknown): Promise<Response> {
  return call("/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName(name),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }, "");
}

async function registerClient(name: string): Promise<string> {
  const res = await postRegistration(name, [REDIRECT_URI]);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeQuery(clientId: string, extra: Record<string, string> = {}): {
  query: URLSearchParams;
  verifier: string;
} {
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
    ...extra,
  });
  return { query, verifier };
}

/**
 * Runs authorize and returns the signed request it put on the consent page's
 * URL. Deliberately sends no `prompt` — real MCP clients don't — so reaching
 * the consent page proves Atrium's before-hook forces it.
 */
async function startConsent(
  clientId: string,
  cookie: string = sessionCookie,
): Promise<{ oauthQuery: string; verifier: string }> {
  const { query, verifier } = authorizeQuery(clientId);
  const res = await call(`/oauth2/authorize?${query}`, {}, cookie);
  expect(res.status).toBe(302);
  const consentUrl = new URL(res.headers.get("location")!);
  expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(`${WEB}/oauth/consent`);
  expect(consentUrl.searchParams.get("client_id")).toBe(clientId);
  expect(consentUrl.searchParams.get("code")).toBeNull();
  return { oauthQuery: consentUrl.search.slice(1), verifier };
}

/** POST /oauth2/consent, the way the consent page sends it. Returns where it says to go. */
async function sendConsent(oauthQuery: string, accept: boolean, cookie: string = sessionCookie): Promise<URL> {
  const res = await call("/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  }, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return new URL(((await res.json()) as { url: string }).url);
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string };

async function exchange(
  clientId: string,
  code: string,
  verifier: string,
  headers: Record<string, string> = {},
): Promise<Tokens> {
  const res = await call("/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  }, "");
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Tokens;
}

function refresh(clientId: string, refreshToken: string): Promise<Response> {
  return call("/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  }, "");
}

/** authorize → Allow → token, with no workspace chosen. */
async function authorizeAndExchange(clientId: string): Promise<Tokens> {
  const { oauthQuery, verifier } = await startConsent(clientId);
  const callback = await sendConsent(oauthQuery, true);
  expect(callback.searchParams.get("state")).toBe("st8");
  return exchange(clientId, callback.searchParams.get("code")!, verifier);
}

/**
 * The whole browser flow: authorize → the consent page's POST /mcp-grants →
 * POST /oauth2/consent → token exchange. `accept: false` stops after consent.
 */
async function connectViaConsentPage(
  clientId: string,
  organizationId: string,
  accept = true,
): Promise<Tokens | null> {
  const { oauthQuery, verifier } = await startConsent(clientId);
  await consentController().create({ oauthQuery, organizationId }, anyRequest, userId);
  const callback = await sendConsent(oauthQuery, accept);
  if (!accept) {
    expect(callback.searchParams.get("error")).toBe("access_denied");
    return null;
  }
  return exchange(clientId, callback.searchParams.get("code")!, verifier);
}

/** Binds a client to a workspace the way the consent page does: park, then promote. */
let pendingSeq = 0;
async function grantWorkspace(clientId: string, organizationId: string, user: string = userId): Promise<void> {
  const request = {
    requestId: `pending-${stamp}-${pendingSeq++}`,
    clientId,
    redirectURI: REDIRECT_URI,
    expiresAt: new Date(Date.now() + 600_000),
  };
  await prisma.mcpPendingGrant.create({
    data: { requestId: request.requestId, userId: user, clientId, organizationId, expiresAt: request.expiresAt },
  });
  await promoteGrantOnConsent(prisma, request, user);
}

async function addWorkspace(suffix: string, role = "owner"): Promise<{ orgId: string; memberId: string }> {
  const id = `org-${suffix}-${stamp}`;
  const memberId = `m-${suffix}-${stamp}`;
  await prisma.organization.create({ data: { id, name: `${suffix} Org`, slug: `${suffix}-${stamp}` } });
  await prisma.member.create({ data: { id: memberId, organizationId: id, userId, role } });
  return { orgId: id, memberId };
}

async function signUp(name: string, address: string): Promise<string> {
  const res = await auth.auth.handler(
    new Request(`${API}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: API },
      body: JSON.stringify({ name, email: address, password: "correct-horse-battery" }),
    }),
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

beforeAll(async () => {
  assertDisposableDatabase();
  prisma = new PrismaService();
  await prisma.$connect();
  auth = new AuthService(config, prisma, mail, billing, {} as never);

  sessionCookie = await signUp("OAuth Tester", email);
  otherSessionCookie = await signUp("Other Tester", otherEmail);
  userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  otherUserId = (await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } })).id;
  orgId = `org-oauth-${stamp}`;
  await prisma.organization.create({ data: { id: orgId, name: "OAuth Org", slug: `oauth-${stamp}` } });
  await prisma.member.create({
    data: { id: `m-oauth-${stamp}`, organizationId: orgId, userId, role: "owner" },
  });
});

afterAll(async () => {
  // Deleting the clients cascades to their tokens and consents. Authorization
  // codes are verification rows whose value names the client.
  const clients = await prisma.oauthClient.findMany({
    where: { name: { endsWith: stamp } },
    select: { clientId: true },
  });
  for (const { clientId } of clients) {
    await prisma.verification.deleteMany({ where: { value: { contains: clientId } } });
  }
  await prisma.oauthClient.deleteMany({ where: { name: { endsWith: stamp } } });
  await prisma.mcpPendingGrant.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.organization.deleteMany({ where: { id: { endsWith: stamp } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
});

describe("Better Auth MCP plugin on Atrium's schema", () => {
  it("serves discovery metadata that points at the OAuth endpoints", async () => {
    const wellKnown = new WellKnownController(auth, config);
    const as = await wellKnown.authorizationServer();
    expect(as.issuer).toBe(`${API}/api/auth`);
    expect(String(as.authorization_endpoint)).toBe(`${API}/api/auth/oauth2/authorize`);
    expect(String(as.token_endpoint)).toBe(`${API}/api/auth/oauth2/token`);
    expect(String(as.registration_endpoint)).toBe(`${API}/api/auth/oauth2/register`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    // The MCP endpoint doesn't check DPoP proofs, so the metadata doesn't offer them.
    expect(as.dpop_signing_alg_values_supported).toBeUndefined();

    expect(wellKnown.protectedResource()).toEqual({
      resource: `${API}/api/mcp`,
      authorization_servers: [`${API}/api/auth`],
      bearer_methods_supported: ["header"],
    });
  });

  it("completes registration → authorize → consent → token and stores the token hashed", async () => {
    const clientId = await registerClient("IT Client A");
    const tokens = await authorizeAndExchange(clientId);

    expect(tokens.access_token.length).toBeGreaterThan(20);
    expect(tokens.refresh_token.length).toBeGreaterThan(20);
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.token_type).toBe("Bearer");

    expect(await prisma.oauthAccessToken.count({ where: { token: tokens.access_token } })).toBe(0);
    const row = await prisma.oauthAccessToken.findUniqueOrThrow({
      where: { token: hashOAuthToken(tokens.access_token) },
    });
    expect(row.userId).toBe(userId);
    expect(row.clientId).toBe(clientId);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.oauthConsent.count({ where: { clientId, userId } })).toBe(1);
  });

  it("sends a signed-out authorize to the login page, and resumes at the consent page after login", async () => {
    const clientId = await registerClient("IT Client B");
    const { query } = authorizeQuery(clientId);

    const res = await call(`/oauth2/authorize?${query}`, {}, "");
    expect(res.status).toBe(302);
    const login = new URL(res.headers.get("location")!);
    expect(`${login.origin}${login.pathname}`).toBe(`${WEB}/login`);
    expect(login.searchParams.get("client_id")).toBe(clientId);
    expect(login.searchParams.get("sig")).toBeTruthy();

    // What the login page does after a successful sign-in.
    const resume = new URL(oauthResumeUrl(login.search, API)!);
    const resumed = await call(`${resume.pathname.replace("/api/auth", "")}${resume.search}`);
    expect(resumed.status).toBe(302);
    const consent = new URL(resumed.headers.get("location")!);
    expect(`${consent.origin}${consent.pathname}`).toBe(`${WEB}/oauth/consent`);
    expect(consent.searchParams.get("code")).toBeNull();
  });

  it("forces the consent page even when the client asks for prompt=none", async () => {
    const clientId = await registerClient("IT Client C");
    const { query } = authorizeQuery(clientId, { prompt: "none" });
    const res = await call(`/oauth2/authorize?${query}`);

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(`${target.origin}${target.pathname}`).toBe(`${WEB}/oauth/consent`);
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("forces the consent page again for a client the user already approved", async () => {
    const clientId = await registerClient("IT Client Again");
    await authorizeAndExchange(clientId);
    // startConsent asserts the consent page, not a code sent to the client.
    await startConsent(clientId);
  });

  it("forces the consent page for an authorize request sent as a form POST", async () => {
    const clientId = await registerClient("IT Client Post");
    const { query } = authorizeQuery(clientId);
    const res = await call("/oauth2/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: query.toString(),
    });

    const target = new URL(res.headers.get("location") ?? ((await res.json()) as { url: string }).url);
    expect(`${target.origin}${target.pathname}`).toBe(`${WEB}/oauth/consent`);
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("refuses a plain code challenge instead of downgrading PKCE", async () => {
    const clientId = await registerClient("IT Client E");
    const { query } = authorizeQuery(clientId, { code_challenge: "notahash", code_challenge_method: "plain" });
    const res = await call(`/oauth2/authorize?${query}`);

    expect(res.status).toBe(302);
    const location: string = res.headers.get("location")!;
    expect(location).toStartWith(`${REDIRECT_URI}?error=invalid_request`);
    expect(location).not.toContain("consent");
    expect(location).not.toContain("code=");
  });

  it("issues an ordinary bearer token when the client sends a DPoP proof", async () => {
    const clientId = await registerClient("IT Client DPoP");
    const { oauthQuery, verifier } = await startConsent(clientId);
    const callback = await sendConsent(oauthQuery, true);

    // Not even a valid proof: the header is dropped before the plugin looks.
    const tokens = await exchange(clientId, callback.searchParams.get("code")!, verifier, { DPoP: "not-a-proof" });

    expect(tokens.token_type).toBe("Bearer");
    const row = await prisma.oauthAccessToken.findUniqueOrThrow({
      where: { token: hashOAuthToken(tokens.access_token) },
    });
    expect(row.confirmation).toBeNull();
  });

  it("registers a client that asks for DPoP-bound tokens as a plain Bearer client", async () => {
    const res = await call("/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: clientName("IT Client DPoP Bound"),
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        dpop_bound_access_tokens: true,
      }),
    }, "");
    expect(res.status, await res.clone().text()).toBe(201);
    const clientId: string = ((await res.json()) as { client_id: string }).client_id;
    const { oauthQuery, verifier } = await startConsent(clientId);
    const callback = await sendConsent(oauthQuery, true);

    const tokens = await exchange(clientId, callback.searchParams.get("code")!, verifier, { DPoP: "not-a-proof" });

    expect(tokens.token_type).toBe("Bearer");
  });

  it("refuses an authorize request that binds the code to a DPoP key", async () => {
    const clientId = await registerClient("IT Client DPoP JKT");
    const { query } = authorizeQuery(clientId, { dpop_jkt: "a".repeat(43) });

    const res = await call(`/oauth2/authorize?${query}`);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("DPoP is not supported");
  });

  it("does not serve the plugin's client and consent management endpoints", async () => {
    const post = (path: string): Promise<Response> => call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: clientName("IT Client Managed") }),
    });
    for (const path of ["/oauth2/create-client", "/oauth2/update-client", "/oauth2/delete-client", "/oauth2/update-consent", "/oauth2/delete-consent", "/oauth2/continue"]) {
      expect((await post(path)).status, path).toBe(404);
    }
    for (const path of ["/oauth2/get-clients", "/oauth2/get-consents"]) {
      expect((await call(path)).status, path).toBe(404);
    }
    expect(await prisma.oauthClient.count({ where: { name: clientName("IT Client Managed") } })).toBe(0);
  });
});

describe("redirect URI validation at client registration", () => {
  /** Registration is anonymous, so a bad URI must never reach the database. */
  function rowCount(name: string): Promise<number> {
    return prisma.oauthClient.count({ where: { name: clientName(name) } });
  }

  it("refuses a javascript: redirect URI", async () => {
    const res = await postRegistration("IT Client XSS", ["javascript:alert(1)"]);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: string }).toMatchObject({ error: "invalid_redirect_uri" });
    expect(await rowCount("IT Client XSS")).toBe(0);
  });

  it("refuses the whole registration when only one URI is script-capable", async () => {
    const res = await postRegistration("IT Client Mixed", ["https://ok.example/cb", "data:text/html,x"]);
    expect(res.status).toBe(400);
    expect(await rowCount("IT Client Mixed")).toBe(0);
  });

  it("refuses a missing or empty redirect_uris list", async () => {
    expect((await postRegistration("IT Client None", undefined)).status).toBe(400);
    expect((await postRegistration("IT Client Empty", [])).status).toBe(400);
    expect(await rowCount("IT Client None")).toBe(0);
    expect(await rowCount("IT Client Empty")).toBe(0);
  });

  it("refuses an entry with a raw comma", async () => {
    const res = await postRegistration("IT Client Smuggle", ["https://ok.example/cb,javascript:alert(1)"]);
    expect(res.status).toBe(400);
    expect(await rowCount("IT Client Smuggle")).toBe(0);
  });

  it("still accepts the redirects native MCP clients use", async () => {
    const custom = await postRegistration("IT Client Native", ["cursor://anysphere.cursor-mcp/callback"]);
    expect(custom.status, await custom.clone().text()).toBe(201);
    const loopback = await postRegistration("IT Client Loopback", ["http://127.0.0.1:33418/callback"]);
    expect(loopback.status, await loopback.clone().text()).toBe(201);
    const web = await postRegistration("IT Client Web", ["https://claude.ai/api/mcp/auth_callback"]);
    expect(web.status, await web.clone().text()).toBe(201);
  });
});

describe("redirect URI validation at authorization", () => {
  it("refuses a redirect_uri the client never registered", async () => {
    const clientId = await registerClient("IT Client Exact");
    const { query } = authorizeQuery(clientId, { redirect_uri: "https://elsewhere.example/cb" });
    const res = await call(`/oauth2/authorize?${query}`);

    // Never the consent page, and never the unregistered address.
    const location: string = res.headers.get("location") ?? "";
    expect(location).not.toContain("/oauth/consent");
    expect(location).not.toStartWith("https://elsewhere.example");
  });

  it("refuses a script redirect_uri even for a legitimately registered client", async () => {
    const clientId = await registerClient("IT Client Script Redirect");
    const { query } = authorizeQuery(clientId, { redirect_uri: "javascript:alert(1)" });
    const res = await call(`/oauth2/authorize?${query}`);

    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("MCP sign-in switched off", () => {
  async function statuses(overrides: Record<string, string>): Promise<number[]> {
    const off = new AuthService(configWith(overrides), prisma, mail, billing, {} as never);
    const hit = async (path: string, init: RequestInit = {}): Promise<number> => {
      const headers = new Headers(init.headers);
      headers.set("Origin", API);
      return (await off.auth.handler(new Request(`${API}/api/auth${path}`, { ...init, headers }))).status;
    };
    return [
      await hit("/.well-known/oauth-authorization-server"),
      await hit(`/oauth2/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`),
      await hit("/oauth2/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName("IT Client Disabled"),
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
        }),
      }),
    ];
  }

  it("serves none of the OAuth endpoints when MCP_OAUTH_ENABLED=false", async () => {
    expect(await statuses({ MCP_OAUTH_ENABLED: "false" })).toEqual([404, 404, 404]);
  });

  it("serves none of them on a plain-HTTP public URL, where the flow cannot work", async () => {
    expect(await statuses({ API_URL: "http://192.168.1.20:3001" })).toEqual([404, 404, 404]);
  });
});

describe("the consent page's view of a request", () => {
  it("reads the client and destination from the signed request", async () => {
    const clientId = await registerClient("IT Client Consent Info");
    const { oauthQuery } = await startConsent(clientId);

    const info = await consentController().consentInfo({ oauthQuery }, userId);

    expect(info.client).toEqual({ clientId, name: clientName("IT Client Consent Info") });
    expect(info.redirect).toEqual({ display: "an app on this computer", kind: "local" });
    expect(info.organizations.map((o) => o.id)).toContain(orgId);
  });

  it("refuses a request whose client was swapped after signing", async () => {
    const asked = await registerClient("IT Client Asked");
    const swapped = await registerClient("IT Client Swapped");
    const { oauthQuery } = await startConsent(asked);
    const tampered = oauthQuery.replace(`client_id=${asked}`, `client_id=${swapped}`);

    await expect(consentController().consentInfo({ oauthQuery: tampered }, userId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      consentController().create({ oauthQuery: tampered, organizationId: orgId }, anyRequest, userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await readSignedConsentRequest(tampered, SECRET)).toBeNull();
  });

  it("parks the choice for the signed client, keyed to the user who made it", async () => {
    const clientId = await registerClient("IT Client Park");
    const { oauthQuery } = await startConsent(clientId);
    await consentController().create({ oauthQuery, organizationId: orgId }, anyRequest, userId);

    const parked = await prisma.mcpPendingGrant.findMany({ where: { clientId } });
    expect(parked).toHaveLength(1);
    expect(parked[0].userId).toBe(userId);
    expect(await prisma.mcpGrant.count({ where: { clientId } })).toBe(0);
  });
});

describe("the workspace choice takes effect only when consent succeeds", () => {
  it("writes no grant until Allow, then binds the workspace the page chose", async () => {
    const clientId = await registerClient("IT Client Promote");
    const { oauthQuery, verifier } = await startConsent(clientId);
    await consentController().create({ oauthQuery, organizationId: orgId }, anyRequest, userId);
    expect(await prisma.mcpGrant.count({ where: { clientId } })).toBe(0);

    const callback = await sendConsent(oauthQuery, true);

    const grant = await prisma.mcpGrant.findUniqueOrThrow({ where: { userId_clientId: { userId, clientId } } });
    expect(grant.organizationId).toBe(orgId);
    expect(await prisma.mcpPendingGrant.count({ where: { clientId } })).toBe(0);

    const tokens = await exchange(clientId, callback.searchParams.get("code")!, verifier);
    expect((await mcpAuthService().resolve(tokens.access_token))?.organization.id).toBe(orgId);
  });

  it("leaves a working connection alone when the user abandons a workspace move", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client Abandoned Move");
    const tokens = (await connectViaConsentPage(clientId, orgId))!;
    const other = await addWorkspace("abandon");

    // The consent page posts its choice, then the tab is closed.
    const { oauthQuery } = await startConsent(clientId);
    await consentController().create({ oauthQuery, organizationId: other.orgId }, anyRequest, userId);

    expect((await mcpAuth.resolve(tokens.access_token))?.organization.id).toBe(orgId);
  });

  it("signs the old connection out once a workspace move is consented to", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client Completed Move");
    const first = (await connectViaConsentPage(clientId, orgId))!;
    const next = await addWorkspace("completed");

    const second = (await connectViaConsentPage(clientId, next.orgId))!;

    expect(await mcpAuth.resolve(first.access_token)).toBeNull();
    expect((await refresh(clientId, first.refresh_token)).status).toBeGreaterThanOrEqual(400);
    expect((await mcpAuth.resolve(second.access_token))?.organization.id).toBe(next.orgId);
  });

  it("keeps the current workspace when an accepted consent issues no code", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client Failed Move");
    const tokens = (await connectViaConsentPage(clientId, orgId))!;
    const other = await addWorkspace("failed-move");
    const { oauthQuery } = await startConsent(clientId);
    await consentController().create({ oauthQuery, organizationId: other.orgId }, anyRequest, userId);

    // The client is switched off between the consent page loading and Allow.
    await prisma.oauthClient.update({ where: { clientId }, data: { disabled: true } });
    const res = await call("/oauth2/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    });
    await prisma.oauthClient.update({ where: { clientId }, data: { disabled: false } });

    expect(res.headers.get("location") ?? (await res.text())).not.toContain("code=");
    expect((await mcpAuth.resolve(tokens.access_token))?.organization.id).toBe(orgId);
  });

  it("Deny drops the parked choice and writes no grant", async () => {
    const clientId = await registerClient("IT Client Denied");
    expect(await connectViaConsentPage(clientId, orgId, false)).toBeNull();
    expect(await prisma.mcpPendingGrant.count({ where: { clientId } })).toBe(0);
    expect(await prisma.mcpGrant.count({ where: { clientId } })).toBe(0);
  });

  it("does not let someone else's consent promote a choice the user parked", async () => {
    const clientId = await registerClient("IT Client Foreign");
    const { oauthQuery } = await startConsent(clientId);
    await consentController().create({ oauthQuery, organizationId: orgId }, anyRequest, userId);

    // The same signed link, approved from another account.
    await sendConsent(oauthQuery, true, otherSessionCookie);

    expect(await prisma.mcpGrant.count({ where: { clientId } })).toBe(0);
    expect(await prisma.mcpPendingGrant.count({ where: { clientId, userId } })).toBe(1);
  });

  it("the nightly sweep clears a choice whose request has expired", async () => {
    const clientId = await registerClient("IT Client Stale Pending");
    await prisma.mcpPendingGrant.create({
      data: { requestId: `stale-${stamp}`, userId, clientId, organizationId: orgId, expiresAt: new Date(Date.now() - 1000) },
    });

    await new OAuthCleanupTask(prisma).pruneExpiredPendingGrants();

    expect(await prisma.mcpPendingGrant.count({ where: { requestId: `stale-${stamp}` } })).toBe(0);
  });
});

describe("OAuth token → MCP actor", () => {
  it("resolves only after a grant exists, and stops after disconnect", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client F");
    const tokens = await authorizeAndExchange(clientId);
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();

    await grantWorkspace(clientId, orgId);
    const actor = await mcpAuth.resolve(tokens.access_token);
    expect(actor?.organization.id).toBe(orgId);
    expect(actor?.member.role).toBe("owner");

    const grant = (await mcpAuth.listGrants(userId, orgId, "owner")).find(
      (g) => g.clientName === clientName("IT Client F"),
    )!;
    await mcpAuth.revokeGrant(grant.id, userId, orgId, "owner");

    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
    expect(await prisma.oauthAccessToken.count({ where: { clientId, userId } })).toBe(0);
    expect((await refresh(clientId, tokens.refresh_token)).status).toBeGreaterThanOrEqual(400);
    // Kept on purpose: it stops the nightly prune deleting a registration the client has cached.
    expect(await prisma.oauthConsent.count({ where: { clientId, userId } })).toBe(1);
  });

  it("keeps working after the user signs out of the dashboard", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client Signed Out");
    const tokens = await authorizeAndExchange(clientId);
    await grantWorkspace(clientId, orgId);

    // Signing out deletes the browser session the token was issued under.
    const row = await prisma.oauthAccessToken.findUniqueOrThrow({ where: { token: hashOAuthToken(tokens.access_token) } });
    await prisma.oauthAccessToken.update({ where: { id: row.id }, data: { sessionId: null } });

    expect((await mcpAuth.resolve(tokens.access_token))?.organization.id).toBe(orgId);
    expect((await refresh(clientId, tokens.refresh_token)).status).toBe(200);
  });

  it("stops resolving once the user is no longer owner or admin", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client Demoted");
    const tokens = await authorizeAndExchange(clientId);
    const demo = await addWorkspace("demo", "admin");
    await grantWorkspace(clientId, demo.orgId);
    expect((await mcpAuth.resolve(tokens.access_token))?.organization.id).toBe(demo.orgId);

    await prisma.member.update({ where: { id: demo.memberId }, data: { role: "member" } });

    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
  });

  it("stays dead after the user is removed and re-added, and after demote then re-promote", async () => {
    const mcpAuth = mcpAuthService();
    const clients = new ClientsService(prisma, {} as never, {} as never);
    const clientId = await registerClient("IT Client Revive");
    const tokens = await authorizeAndExchange(clientId);
    const revive = await addWorkspace("revive", "admin");
    await grantWorkspace(clientId, revive.orgId);
    expect((await mcpAuth.resolve(tokens.access_token))?.organization.id).toBe(revive.orgId);

    await clients.changeRole(revive.memberId, "member", revive.orgId, otherUserId);
    await clients.changeRole(revive.memberId, "admin", revive.orgId, otherUserId);
    expect(await prisma.mcpGrant.count({ where: { userId, clientId } })).toBe(0);
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();

    await grantWorkspace(clientId, revive.orgId);
    await prisma.member.delete({ where: { id: revive.memberId } });
    expect(await prisma.mcpGrant.count({ where: { userId, clientId } })).toBe(0);
    await prisma.member.create({
      data: { id: `m-revive2-${stamp}`, organizationId: revive.orgId, userId, role: "admin" },
    });
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
  });

  it("rejects an expired or revoked access token", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client G");
    const tokens = await authorizeAndExchange(clientId);
    await grantWorkspace(clientId, orgId);
    const where = { token: hashOAuthToken(tokens.access_token) };

    await prisma.oauthAccessToken.update({ where, data: { revoked: new Date() } });
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();

    await prisma.oauthAccessToken.update({ where, data: { revoked: null, expiresAt: new Date(Date.now() - 1000) } });
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
  });

  it("issues a fresh access token from a refresh token", async () => {
    const mcpAuth = mcpAuthService();
    const clientId = await registerClient("IT Client H");
    const tokens = await authorizeAndExchange(clientId);
    await grantWorkspace(clientId, orgId);

    const res = await refresh(clientId, tokens.refresh_token);
    expect(res.status).toBe(200);
    const refreshed = (await res.json()) as Tokens;
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect((await mcpAuth.resolve(refreshed.access_token))?.organization.id).toBe(orgId);
  });
});

describe("nightly OAuth cleanup", () => {
  const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

  /** A registration written straight to the table, so its age can be chosen. */
  async function registration(suffix: string, createdAt: Date): Promise<string> {
    const clientId = `cleanup-${suffix}-${stamp}`;
    await prisma.oauthClient.create({
      data: {
        id: `app-${clientId}`,
        name: clientName(`IT Cleanup ${suffix}`),
        clientId,
        redirectUris: [REDIRECT_URI],
        tokenEndpointAuthMethod: "none",
        createdAt,
        updatedAt: createdAt,
      },
    });
    return clientId;
  }

  function token(id: string, clientId: string, expiresAt: Date): Promise<unknown> {
    return prisma.oauthAccessToken.create({
      data: { id, token: id, clientId, userId, scopes: ["openid"], createdAt: OLD, expiresAt },
    });
  }

  it("prunes only abandoned registrations, and clears expired tokens", async () => {
    const abandoned = await registration("abandoned", OLD);
    const consented = await registration("consented", OLD);
    const inUse = await registration("in-use", OLD);
    const refreshable = await registration("refreshable", OLD);
    const granted = await registration("granted", OLD);
    const recent = await registration("recent", new Date());

    await prisma.oauthConsent.create({
      data: { id: `oc-${stamp}`, clientId: consented, userId, scopes: ["openid"], createdAt: OLD, updatedAt: OLD },
    });
    await prisma.mcpGrant.create({
      data: { id: `mg-${stamp}`, userId, clientId: granted, organizationId: orgId, memberId: `m-oauth-${stamp}` },
    });
    await token(`tok-live-${stamp}`, inUse, new Date(Date.now() + 3_600_000));
    await token(`tok-dead-${stamp}`, recent, new Date(Date.now() - 1_000));
    await prisma.oauthRefreshToken.create({
      data: {
        id: `rt-live-${stamp}`, token: `rt-live-${stamp}`, clientId: refreshable, userId,
        scopes: ["offline_access"], createdAt: OLD, expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await new OAuthCleanupTask(prisma).nightlyCleanup();

    const kept = (clientId: string): Promise<number> => prisma.oauthClient.count({ where: { clientId } });
    expect(await kept(abandoned)).toBe(0);
    expect(await kept(consented)).toBe(1);
    expect(await kept(inUse)).toBe(1);
    expect(await kept(refreshable)).toBe(1);
    expect(await kept(granted)).toBe(1);
    expect(await kept(recent)).toBe(1);
    expect(await prisma.oauthAccessToken.count({ where: { id: `tok-dead-${stamp}` } })).toBe(0);
    expect(await prisma.oauthAccessToken.count({ where: { id: `tok-live-${stamp}` } })).toBe(1);

    await prisma.mcpGrant.deleteMany({ where: { id: `mg-${stamp}` } });
  });
});
