import { afterEach, describe, expect, it } from "bun:test";
import { postAuth } from "./auth-fetch";

type FetchArgs = [input: string, init?: RequestInit];

const realFetch = globalThis.fetch;
const realError = console.error;

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

/** Swallows the logging every catch block does, so test output stays clean. */
function muteErrors(): void {
  console.error = () => {};
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchArgs[] {
  const calls: FetchArgs[] = [];
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    calls.push([String(input), init]);
    return handler(String(input), init);
  }) as unknown as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** fetch with redirect: "manual" yields a response whose type is opaqueredirect. */
function opaqueRedirect(): Response {
  const res = new Response(null, { status: 200 });
  Object.defineProperty(res, "type", { value: "opaqueredirect" });
  return res;
}

describe("postAuth", () => {
  it("posts JSON to the auth proxy with cookies and without following redirects", async () => {
    const calls = stubFetch(async () => json({ user: { id: "u1" } }));

    const result = await postAuth("/sign-in/email", { email: "a@b.co" });

    expect(result.ok).toBe(true);
    const [url, init] = calls[0];
    expect(url).toEndWith("/api/auth/sign-in/email");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBe(JSON.stringify({ email: "a@b.co" }));
  });

  it("returns the server's message and status for a rejected sign-in", async () => {
    stubFetch(async () => json({ message: "Invalid email or password", code: "INVALID" }, 401));

    const result = await postAuth("/sign-in/email", {});

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "Invalid email or password",
      code: "INVALID",
    });
  });

  it("accepts an opaque redirect only once a session is confirmed", async () => {
    const calls = stubFetch(async (url) =>
      url.endsWith("/get-session") ? json({ user: { id: "u1" } }) : opaqueRedirect(),
    );

    const result = await postAuth("/sign-in/email", {});

    expect(result.ok).toBe(true);
    expect(calls[1][0]).toEndWith("/api/auth/get-session");
  });

  it("rejects an opaque redirect when no session was actually created", async () => {
    // Better Auth answers with a 302 whenever a signed oidc_login_prompt
    // cookie is present, so a redirect on its own proves nothing.
    stubFetch(async (url) => (url.endsWith("/get-session") ? json(null) : opaqueRedirect()));

    const result = await postAuth("/sign-in/email", {});

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("rejects an opaque redirect when the session check itself fails", async () => {
    muteErrors();
    stubFetch(async (url) => {
      if (url.endsWith("/get-session")) throw new Error("offline");
      return opaqueRedirect();
    });

    expect((await postAuth("/sign-in/email", {})).ok).toBe(false);
  });

  it("reports a network error instead of throwing", async () => {
    muteErrors();
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await postAuth("/sign-in/email", {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toBeTruthy();
  });

  it("survives an error response that is not JSON", async () => {
    muteErrors();
    stubFetch(async () => new Response("<html>502</html>", { status: 502 }));

    const result = await postAuth("/sign-in/email", {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.message).toBeUndefined();
  });
});
