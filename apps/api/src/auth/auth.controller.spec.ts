import { describe, expect, it } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthController } from "./auth.controller";

/** Better Auth is handed a Web API Request, not the Express one. */
type WebRequest = globalThis.Request;

interface Captured {
  request: WebRequest | undefined;
  body: string | undefined;
}

interface Sent {
  status: number | undefined;
  headers: Record<string, string | string[]>;
  body: string | undefined;
  ended: boolean;
}

/**
 * Builds a controller wired to a stub AuthService whose `auth.handler`
 * returns `response`, plus recorders for what reached Better Auth and what
 * was written back to Express.
 */
function build(response: Response_ = new Response("{}")): {
  controller: AuthController;
  captured: Captured;
  sent: Sent;
} {
  const captured: Captured = { request: undefined, body: undefined };
  const authService = {
    // Always reads the body, so "no body forwarded" means an empty one rather
    // than a branch in the stub that can never disagree with the controller.
    handleRequest: async (request: WebRequest): Promise<Response_> => {
      captured.request = request;
      captured.body = await request.text();
      return response;
    },
  };
  const config = { get: (key: string) => (key === "BETTER_AUTH_URL" ? "http://api.test" : undefined) };
  const controller = new AuthController(authService as never, config as never);
  // Keep the test output pristine; the proxy logs every request it handles.
  (controller as unknown as { logger: { log: () => void } }).logger = {
    log: () => {},
  };

  const sent: Sent = { status: undefined, headers: {}, body: undefined, ended: false };
  return { controller, captured, sent };
}

type Response_ = globalThis.Response;

function expressRes(sent: Sent): Response {
  return {
    status: (code: number) => {
      sent.status = code;
    },
    setHeader: (name: string, value: string | string[]) => {
      sent.headers[name.toLowerCase()] = value;
    },
    send: (body: string) => {
      sent.body = body;
    },
    end: () => {
      sent.ended = true;
    },
  } as unknown as Response;
}

function expressReq(
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Request {
  return {
    method,
    originalUrl: "/api/auth/mcp/token",
    headers,
    body,
  } as unknown as Request;
}

describe("AuthController", () => {
  it("does not forward Better Auth's CORS headers, but forwards other headers and cookies", async () => {
    const upstream = new Response("{}", {
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "cache-control": "no-store",
        "set-cookie": "better-auth.session_token=abc; Path=/",
      },
    });
    const { controller, sent } = build(upstream);

    await controller.handleAuth(expressReq("GET", {}), expressRes(sent));

    expect(sent.headers["access-control-allow-origin"]).toBeUndefined();
    expect(sent.headers["access-control-allow-methods"]).toBeUndefined();
    expect(sent.headers["cache-control"]).toBe("no-store");
    expect(sent.headers["set-cookie"]).toEqual([
      "better-auth.session_token=abc; Path=/",
    ]);
  });

  it("forwards a form-encoded body as urlencoded, round-tripping special characters", async () => {
    const { controller, captured, sent } = build();

    await controller.handleAuth(
      expressReq(
        "POST",
        { "content-type": "application/x-www-form-urlencoded" },
        { grant_type: "authorization_code", code: "a b&c=d" },
      ),
      expressRes(sent),
    );

    const parsed = new URLSearchParams(captured.body);
    expect(parsed.get("grant_type")).toBe("authorization_code");
    expect(parsed.get("code")).toBe("a b&c=d");
    expect(captured.body).toContain("code=a+b%26c%3Dd");
  });

  it("forwards repeated form keys as repeated keys and skips non-string values", async () => {
    const { controller, captured, sent } = build();

    await controller.handleAuth(
      expressReq(
        "POST",
        { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        { scope: ["openid", "profile"], nested: { a: 1 }, client_id: "abc" },
      ),
      expressRes(sent),
    );

    const parsed = new URLSearchParams(captured.body);
    expect(parsed.getAll("scope")).toEqual(["openid", "profile"]);
    expect(parsed.get("client_id")).toBe("abc");
    expect(parsed.has("nested")).toBe(false);
  });

  it("forwards a JSON body as JSON", async () => {
    const { controller, captured, sent } = build();

    await controller.handleAuth(
      expressReq("POST", { "content-type": "application/json" }, { email: "a@b.c" }),
      expressRes(sent),
    );

    expect(captured.body).toBe('{"email":"a@b.c"}');
  });

  it("forwards no body on GET", async () => {
    const { controller, captured, sent } = build();

    await controller.handleAuth(expressReq("GET", {}), expressRes(sent));

    expect(captured.body).toBe("");
  });

  it("drops content-length and transfer-encoding from the forwarded headers", async () => {
    const { controller, captured, sent } = build();

    await controller.handleAuth(
      expressReq(
        "POST",
        {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "999",
          "transfer-encoding": "chunked",
          host: "portal.test",
        },
        { a: "b" },
      ),
      expressRes(sent),
    );

    const headers: Headers = captured.request!.headers;
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("host")).toBe("portal.test");
  });

  describe("organization routes that list other members", () => {
    /** An auth-route request as SessionMiddleware leaves it: the caller's active org and role. */
    function orgReq(url: string, role: string | undefined, method: string = "GET"): Request {
      return {
        method,
        originalUrl: url,
        headers: {},
        organization: { id: "org-1", slug: "acme" },
        member: role ? { id: "m-1", userId: "u-1", organizationId: "org-1", role } : undefined,
      } as unknown as Request;
    }

    async function call(req: Request): Promise<{ forwarded: boolean; error: unknown }> {
      const { controller, captured, sent } = build();
      let error: unknown;
      try {
        await controller.handleAuth(req, expressRes(sent));
      } catch (err) {
        error = err;
      }
      return { forwarded: captured.request !== undefined, error };
    }

    const refused: string[] = [
      "/api/auth/organization/get-full-organization",
      "/api/auth/organization/list-members",
      "/api/auth/organization/list-invitations",
      "/api/auth/organization/get-active-member-role?userId=u-2",
    ];

    for (const url of refused) {
      it(`refuses ${url} to a portal client`, async () => {
        const { forwarded, error } = await call(orgReq(url, "member"));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(forwarded).toBe(false);
      });

      it(`refuses ${url} to a caller with no membership`, async () => {
        const { forwarded, error } = await call(orgReq(url, undefined));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(forwarded).toBe(false);
      });
    }

    for (const role of ["owner", "admin"]) {
      it(`forwards them for an ${role}`, async () => {
        for (const url of refused) {
          const { forwarded, error } = await call(orgReq(url, role));
          expect(error).toBeUndefined();
          expect(forwarded).toBe(true);
        }
      });
    }

    it("refuses spellings of a blocked path that Better Auth may still route", async () => {
      for (const url of [
        "/api/auth/organization/list-members/",
        "/api/auth//organization/list-members",
        "//api/auth/organization/list-members",
        "/api/auth/organization/LIST-MEMBERS",
        "/api/auth/organization/list%2Dmembers",
      ]) {
        const { forwarded, error } = await call(orgReq(url, "member"));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(forwarded).toBe(false);
      }
    });

    it("refuses an owner reading another workspace by id or slug", async () => {
      for (const url of [
        "/api/auth/organization/list-members?organizationId=org-2",
        "/api/auth/organization/get-full-organization?organizationSlug=other",
      ]) {
        const { forwarded, error } = await call(orgReq(url, "owner"));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(forwarded).toBe(false);
      }
    });

    it("forwards an owner naming their own active workspace", async () => {
      const { forwarded } = await call(
        orgReq("/api/auth/organization/get-full-organization?organizationId=org-1&organizationSlug=acme", "owner"),
      );
      expect(forwarded).toBe(true);
    });

    it("forwards the routes portal, login and accept-invite use, for a portal client", async () => {
      const routes: [string, string][] = [
        ["GET", "/api/auth/organization/list"],
        ["POST", "/api/auth/organization/set-active"],
        ["GET", "/api/auth/organization/get-active-member"],
        ["POST", "/api/auth/organization/accept-invitation"],
        ["GET", "/api/auth/organization/get-invitation?id=inv-1"],
        ["POST", "/api/auth/organization/leave"],
        ["GET", "/api/auth/get-session"],
      ];
      for (const [method, url] of routes) {
        const { forwarded, error } = await call(orgReq(url, "member", method));
        expect(error).toBeUndefined();
        expect(forwarded).toBe(true);
      }
    });
  });
});
