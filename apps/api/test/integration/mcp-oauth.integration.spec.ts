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
import { McpAuthService } from "../../src/mcp-auth/mcp-auth.service";

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

/**
 * The name a client registered through `registerClient` actually carries.
 * Names are stamped per run so cleanup can delete exactly this run's rows.
 */
export function clientName(name: string): string {
  return `${name} ${stamp}`;
}

/** Client ids minted by this run, so their verification rows can be cleaned up. */
const registeredClientIds: string[] = [];

/** Posts a raw registration request, without asserting on the outcome. */
async function postRegistration(
  name: string,
  redirectUris: unknown,
): Promise<Response> {
  return call("/mcp/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName(name),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
}

export async function registerClient(name: string): Promise<string> {
  const res = await postRegistration(name, [REDIRECT_URI]);
  // The plugin answers dynamic registration with 201 Created (RFC 7591).
  expect(res.status).toBe(201);
  const clientId = ((await res.json()) as { client_id: string }).client_id;
  registeredClientIds.push(clientId);
  return clientId;
}

/**
 * Runs authorize → consent → token and returns the token response.
 *
 * Deliberately sends no `prompt` — real MCP clients don't — to prove Atrium's
 * before-hook forces the consent step server-side. Without that hook the
 * plugin would bounce straight back to the client's redirect_uri with a code
 * and drop `state` on the floor.
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
  // Authorization/consent codes live in `verification` rows keyed by the code
  // itself; the only thing tying one to this run is the clientId inside its
  // JSON `value`, so match on that rather than on a name prefix.
  for (const clientId of registeredClientIds) {
    await prisma.verification.deleteMany({
      where: { value: { contains: `"clientId":"${clientId}"` } },
    });
  }
  await prisma.oauthApplication.deleteMany({
    where: { name: { endsWith: stamp } },
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
    // S256 only — the authorize endpoint is configured to refuse `plain`, so
    // the metadata must not advertise it either.
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);

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

  it("forces the consent page even when the client asks for prompt=none", async () => {
    const clientId = await registerClient("IT Client C");
    const res = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=x&prompt=none&code_challenge=abc&code_challenge_method=S256`,
    );

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(`${target.origin}${target.pathname}`).toBe(`${WEB}/oauth/consent`);
    // A silent grant would have sent a code to the client instead.
    expect(target.searchParams.get("code")).toBeNull();
    expect(target.searchParams.get("consent_code")).toBeTruthy();
  });

  it("resumes a signed-out authorize at the consent page after login, not at the client", async () => {
    const clientId = await registerClient("IT Client D");
    const saved = sessionCookie;
    sessionCookie = "";
    const authorize = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=resume&code_challenge=abc&code_challenge_method=S256`,
    );
    sessionCookie = saved;

    expect(authorize.status).toBe(302);
    const promptCookie: string = authorize.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => c.startsWith("oidc_login_prompt="))
      .join("; ");
    expect(promptCookie).not.toBe("");

    // The plugin's after-hook replays the stashed query on any response that
    // mints a session, so signing in is what continues the OAuth flow.
    const signIn = await auth.auth.handler(
      new Request(`${API}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: API,
          Cookie: promptCookie,
        },
        body: JSON.stringify({ email, password: "correct-horse-battery" }),
      }),
    );

    expect(signIn.status).toBe(302);
    const resumed = new URL(signIn.headers.get("location")!);
    expect(`${resumed.origin}${resumed.pathname}`).toBe(`${WEB}/oauth/consent`);
    expect(resumed.searchParams.get("client_id")).toBe(clientId);
    expect(resumed.searchParams.get("code")).toBeNull();
  });

  it("refuses a plain code challenge instead of downgrading PKCE", async () => {
    const clientId = await registerClient("IT Client E");
    const res = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=x&code_challenge=notahash&code_challenge_method=plain`,
    );

    // authorize.mjs reports an unusable challenge method rather than
    // downgrading. Its `redirectErrorURL` helper is buggy — it returns only the
    // query fragment and drops the redirect_uri — so Location is relative.
    expect(res.status).toBe(302);
    const location: string = res.headers.get("location")!;
    expect(location).toStartWith("?error=invalid_request");
    expect(location).toContain("invalid code_challenge method");
    // Neither a code nor a consent prompt: the request dies before either.
    expect(location).not.toContain("consent");
    expect(location).not.toContain("code=");
    expect(await prisma.oauthAccessToken.count({ where: { clientId } })).toBe(
      0,
    );
  });
});

describe("redirect URI validation at client registration", () => {
  /** Registration is anonymous, so a bad URI must never reach the database. */
  async function rowCount(name: string): Promise<number> {
    return prisma.oauthApplication.count({
      where: { name: clientName(name) },
    });
  }

  it("refuses a javascript: redirect URI", async () => {
    const res = await postRegistration("IT Client XSS", [
      "javascript:alert(1)",
    ]);

    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: string }).toMatchObject({
      error: "invalid_redirect_uri",
    });
    expect(await rowCount("IT Client XSS")).toBe(0);
  });

  it("refuses the whole registration when only one URI is script-capable", async () => {
    const res = await postRegistration("IT Client Mixed", [
      "https://ok.example/cb",
      "data:text/html,x",
    ]);

    expect(res.status).toBe(400);
    expect(await rowCount("IT Client Mixed")).toBe(0);
  });

  it("refuses a missing or empty redirect_uris list", async () => {
    expect((await postRegistration("IT Client None", undefined)).status).toBe(
      400,
    );
    expect((await postRegistration("IT Client Empty", [])).status).toBe(400);
    expect(await rowCount("IT Client None")).toBe(0);
    expect(await rowCount("IT Client Empty")).toBe(0);
  });

  it("refuses a comma-smuggled second URI hidden in one entry", async () => {
    // The plugin stores redirect_uris comma-joined and splits on "," at
    // authorize time, so this single valid-looking https URI would become two
    // registered URIs, the second being executable script.
    const res = await postRegistration("IT Client Smuggle", [
      "https://ok.example/cb,javascript:alert(1)",
    ]);

    expect(res.status).toBe(400);
    expect((await res.json()) as { error?: string }).toMatchObject({
      error: "invalid_redirect_uri",
    });
    expect(await rowCount("IT Client Smuggle")).toBe(0);
  });

  it("still accepts the custom schemes native MCP clients use", async () => {
    const res = await postRegistration("IT Client Native", [
      "cursor://anysphere.cursor-mcp/callback",
    ]);

    expect(res.status).toBe(201);
    registeredClientIds.push(
      ((await res.json()) as { client_id: string }).client_id,
    );
    expect(await rowCount("IT Client Native")).toBe(1);
  });
});

describe("redirect URI validation at authorization", () => {
  it("refuses a redirect_uri the client never registered", async () => {
    const clientId = await registerClient("IT Client Exact");
    const res = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://elsewhere.example/cb")}&state=x&code_challenge=abc&code_challenge_method=S256`,
    );

    // The plugin matches registered URIs by exact string equality — which is
    // precisely why a smuggled entry would be honoured, so pin the behaviour.
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Invalid redirect URI");
  });

  it("refuses a script redirect_uri even for a legitimately registered client", async () => {
    const clientId = await registerClient("IT Client Script Redirect");
    const res = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("javascript:alert(1)")}&state=x&code_challenge=abc&code_challenge_method=S256`,
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("refuses a smuggled redirect_uri already stored on an existing client", async () => {
    // Rows written before the registration check existed (or by any other
    // route) can still hold a comma-smuggled entry, so authorize must refuse
    // it on its own.
    const clientId = `legacy-smuggled-${stamp}`;
    await prisma.oauthApplication.create({
      data: {
        id: `app-legacy-${stamp}`,
        name: clientName("IT Client Legacy"),
        clientId,
        clientSecret: "",
        redirectUrls: `${REDIRECT_URI},javascript:alert(1)`,
        type: "public",
        disabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    registeredClientIds.push(clientId);

    const res = await call(
      `/mcp/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("javascript:alert(1)")}&state=x&code_challenge=abc&code_challenge_method=S256`,
    );

    expect(res.status).toBe(400);
    // No consent page, no authorization code, nowhere to navigate to.
    expect(res.headers.get("location")).toBeNull();
    expect(
      await prisma.oauthAccessToken.count({ where: { clientId } }),
    ).toBe(0);
  });
});

describe("MCP_OAUTH_ENABLED=false", () => {
  let disabled: AuthService;

  beforeAll(() => {
    const disabledConfig = {
      get: (key: string, fallback?: string) => {
        if (key === "WEB_URL") return WEB;
        if (key === "API_URL") return API;
        if (key === "MCP_OAUTH_ENABLED") return "false";
        return fallback;
      },
      getOrThrow: (key: string) => {
        if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
        throw new Error(`Missing ${key}`);
      },
    } as unknown as ConfigService;
    disabled = new AuthService(disabledConfig, prisma, mail, billing);
  });

  async function hit(path: string, init: RequestInit = {}): Promise<number> {
    const headers = new Headers(init.headers);
    headers.set("Origin", API);
    const res = await disabled.auth.handler(
      new Request(`${API}/api/auth${path}`, { ...init, headers }),
    );
    return res.status;
  }

  it("serves none of the OAuth endpoints", async () => {
    expect(await hit("/.well-known/oauth-authorization-server")).toBe(404);
    expect(
      await hit(
        `/mcp/authorize?response_type=code&client_id=x&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      ),
    ).toBe(404);
    expect(
      await hit("/mcp/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName("IT Client Disabled"),
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
        }),
      }),
    ).toBe(404);
  });
});

describe("OAuth token → MCP actor", () => {
  it("resolves only after a grant exists, and stops after disconnect", async () => {
    const mcpAuth = new McpAuthService(prisma);
    const clientId = await registerClient("IT Client F");
    const tokens = await authorizeAndExchange(clientId);

    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();

    await mcpAuth.saveGrant(userId, clientId, orgId);
    const actor = await mcpAuth.resolve(tokens.access_token);
    expect(actor?.organization.id).toBe(orgId);
    expect(actor?.member.role).toBe("owner");

    const [grant] = await mcpAuth.listGrants(userId, orgId, "owner");
    expect(grant.clientName).toBe(clientName("IT Client F"));
    await mcpAuth.revokeGrant(grant.id, userId, orgId, "owner");

    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
    expect(await prisma.oauthAccessToken.count({ where: { clientId, userId } })).toBe(0);
    expect(await prisma.oauthConsent.count({ where: { clientId, userId } })).toBe(0);
  });

  it("rejects an expired access token", async () => {
    const mcpAuth = new McpAuthService(prisma);
    const clientId = await registerClient("IT Client G");
    const tokens = await authorizeAndExchange(clientId);
    await mcpAuth.saveGrant(userId, clientId, orgId);
    await prisma.oauthAccessToken.update({
      where: { accessToken: tokens.access_token },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await mcpAuth.resolve(tokens.access_token)).toBeNull();
  });

  it("issues a fresh access token from a refresh token", async () => {
    const clientId = await registerClient("IT Client H");
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
