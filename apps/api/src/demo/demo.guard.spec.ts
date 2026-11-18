import { describe, expect, it, mock } from "bun:test";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { DemoGuard } from "./demo.guard";
import type { DemoService } from "./demo.service";

const DEMO_ORG = "org-demo";

function context(
  method: string,
  url: string,
  organizationId?: string,
  contentType?: string,
): ExecutionContext {
  const request = {
    method,
    originalUrl: url,
    organization: organizationId ? { id: organizationId } : undefined,
    headers: contentType ? { "content-type": contentType } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => () => {} }),
  } as unknown as ExecutionContext;
}

function guard(options: { enabled?: boolean } = {}): { guard: DemoGuard; touch: ReturnType<typeof mock> } {
  const touch = mock(() => {});
  const demo = {
    enabled: options.enabled ?? true,
    touch,
    isDemoOrg: async (id: string | undefined | null) => (options.enabled ?? true) && id === DEMO_ORG,
  };
  return { guard: new DemoGuard(demo as unknown as DemoService), touch };
}

describe("DemoGuard", () => {
  it("allows everything when demo mode is off", async () => {
    const { guard: g } = guard({ enabled: false });
    expect(await g.canActivate(context("POST", "/api/files/upload", DEMO_ORG))).toBe(true);
  });

  it("allows the request when no organization is resolved", async () => {
    // Anonymous or pre-session: must not throw, and must not grant anything either.
    const { guard: g } = guard();
    expect(await g.canActivate(context("POST", "/api/files/upload"))).toBe(true);
  });

  it("allows reads inside the demo org", async () => {
    const { guard: g } = guard();
    expect(await g.canActivate(context("GET", "/api/projects", DEMO_ORG))).toBe(true);
  });

  it("allows ordinary writes inside the demo org", async () => {
    const { guard: g } = guard();
    expect(await g.canActivate(context("POST", "/api/projects", DEMO_ORG))).toBe(true);
    expect(await g.canActivate(context("PATCH", "/api/tasks/abc", DEMO_ORG))).toBe(true);
  });

  it("records activity on a mutating request, so a reset skips a live visitor", async () => {
    const { guard: g, touch } = guard();
    await g.canActivate(context("POST", "/api/projects", DEMO_ORG));
    expect(touch).toHaveBeenCalled();
  });

  it("refuses a file upload with a message the UI can show", async () => {
    const { guard: g } = guard();
    await expect(g.canActivate(context("POST", "/api/files/upload", DEMO_ORG))).rejects.toThrow(
      /Uploads are turned off in the demo/,
    );
    await expect(
      g.canActivate(context("POST", "/api/files/upload/mine", DEMO_ORG)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      g.canActivate(context("POST", "/api/branding/logo", DEMO_ORG)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses api keys, mcp grants, billing, payments and custom domains", async () => {
    const { guard: g } = guard();
    const blocked: [string, string][] = [
      ["POST", "/api/api-keys"],
      ["POST", "/api/mcp-grants"],
      ["POST", "/api/billing/checkout"],
      ["POST", "/api/billing/portal"],
      ["POST", "/api/payments/connect/authorize"],
      ["POST", "/api/payments/direct/save-key"],
      ["POST", "/api/integrations"],
      ["PUT", "/api/settings/custom-domain"],
      ["DELETE", "/api/settings/custom-domain"],
    ];
    for (const [method, url] of blocked) {
      await expect(g.canActivate(context(method, url, DEMO_ORG))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it("refuses invites and workspace deletion, which go through Better Auth", async () => {
    const { guard: g } = guard();
    await expect(
      g.canActivate(context("POST", "/api/auth/organization/invite-member", DEMO_ORG)),
    ).rejects.toThrow(/Inviting people is turned off in the demo/);
    await expect(
      g.canActivate(context("POST", "/api/auth/organization/delete", DEMO_ORG)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ignores the query string when matching", async () => {
    const { guard: g } = guard();
    await expect(
      g.canActivate(context("POST", "/api/api-keys?foo=bar", DEMO_ORG)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("never refuses an identical path in a non-demo org", async () => {
    const { guard: g } = guard();
    expect(await g.canActivate(context("POST", "/api/files/upload", "org-real"))).toBe(true);
    expect(await g.canActivate(context("POST", "/api/api-keys", "org-real"))).toBe(true);
  });

  it("does not refuse demo entry itself", async () => {
    const { guard: g } = guard();
    expect(await g.canActivate(context("POST", "/api/demo/enter", DEMO_ORG))).toBe(true);
  });

  it("refuses any multipart body in the demo org, whatever the route", async () => {
    // The path list is not the fence: the demo's own "Upload file" button posts
    // to POST /documents, and /updates, /invoices/upload and the document
    // signing routes all take files too. Blocking the capability covers the
    // routes nobody thought of, including ones added later.
    const { guard: g } = guard();
    const uploads: [string, string][] = [
      ["POST", "/api/documents"],
      ["POST", "/api/documents/abc/upload-version"],
      ["POST", "/api/documents/abc/sign"],
      ["POST", "/api/updates"],
      ["POST", "/api/invoices/upload"],
      ["POST", "/api/some/route/added/next/year"],
    ];
    for (const [method, url] of uploads) {
      await expect(
        g.canActivate(context(method, url, DEMO_ORG, "multipart/form-data; boundary=x")),
      ).rejects.toThrow(/Uploads are turned off in the demo/);
    }
  });

  it("still allows a JSON write to those same routes", async () => {
    const { guard: g } = guard();
    expect(
      await g.canActivate(context("POST", "/api/updates", DEMO_ORG, "application/json")),
    ).toBe(true);
  });

  it("allows a multipart body in a workspace that is not the demo", async () => {
    const { guard: g } = guard();
    expect(
      await g.canActivate(context("POST", "/api/documents", "org-real", "multipart/form-data")),
    ).toBe(true);
  });

  it("refuses account deletion and workspace settings, which a reset cannot undo", async () => {
    // User and SystemSettings rows deliberately survive a reset, so damage here
    // is permanent in a way project data is not.
    const { guard: g } = guard();
    await expect(g.canActivate(context("DELETE", "/api/account", DEMO_ORG))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(g.canActivate(context("PUT", "/api/settings", DEMO_ORG))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("counts a read as activity, so a visitor browsing is not reseeded under", async () => {
    const { guard: g, touch } = guard();
    await g.canActivate(context("GET", "/api/projects", DEMO_ORG));
    expect(touch).toHaveBeenCalled();
  });

  describe("writes are allowlisted, not blocklisted", () => {
    // Two reviews found the same defect: a path blocklist over an API surface
    // this guard does not own. Better Auth's routes alone cannot be
    // enumerated, and every miss was a hole (uploads via /documents, 2FA
    // enforcement that no reset clears, an org rename that bricks the reset).
    // Inverted, a route nobody thought of is a route that does not work in the
    // demo -- visible and harmless -- instead of an open door.

    it("allows the writes the demo exists to show", async () => {
      const { guard: g } = guard();
      const allowed: [string, string][] = [
        ["POST", "/api/projects"],
        ["PATCH", "/api/projects/p1"],
        ["POST", "/api/tasks"],
        ["PATCH", "/api/tasks/t1"],
        ["POST", "/api/updates"],
        ["POST", "/api/comments"],
        ["POST", "/api/notes"],
        ["POST", "/api/invoices"],
        ["POST", "/api/contacts"],
        ["POST", "/api/companies"],
        ["POST", "/api/labels"],
        ["POST", "/api/time-entries"],
        ["POST", "/api/project-statuses"],
        ["POST", "/api/pursuit-stages"],
        ["POST", "/api/files/link"],
        ["PUT", "/api/branding"],
        ["PUT", "/api/clients/me/profile"],
        ["PATCH", "/api/notifications/n1"],
        ["POST", "/api/auth/sign-out"],
      ];
      for (const [method, url] of allowed) {
        expect(await g.canActivate(context(method, url, DEMO_ORG, "application/json"))).toBe(true);
      }
    });

    it("refuses 2FA enforcement, which no reset can undo", async () => {
      // SystemSettings and User rows deliberately survive a reset, so one
      // visitor turning this on would gate every later visitor forever.
      const { guard: g } = guard();
      await expect(
        g.canActivate(context("PUT", "/api/two-factor/requirement", DEMO_ORG, "application/json")),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        g.canActivate(context("POST", "/api/auth/two-factor/enable", DEMO_ORG, "application/json")),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuses the Better Auth routes that would break the reset or the workspace", async () => {
      const { guard: g } = guard();
      const refused: [string, string][] = [
        ["POST", "/api/auth/organization/update"],
        ["POST", "/api/auth/organization/create"],
        ["POST", "/api/auth/organization/invite-member"],
        ["POST", "/api/auth/organization/delete"],
        ["POST", "/api/auth/change-email"],
        ["POST", "/api/auth/change-password"],
      ];
      for (const [method, url] of refused) {
        await expect(
          g.canActivate(context(method, url, DEMO_ORG, "application/json")),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it("refuses a route nobody has thought of yet", async () => {
      const { guard: g } = guard();
      await expect(
        g.canActivate(context("POST", "/api/some-feature-shipped-next-year", DEMO_ORG)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("still allows every read", async () => {
      const { guard: g } = guard();
      for (const url of ["/api/settings", "/api/billing", "/api/two-factor", "/api/anything"]) {
        expect(await g.canActivate(context("GET", url, DEMO_ORG))).toBe(true);
      }
    });

    it("tells a visitor why an upload specifically was refused", async () => {
      const { guard: g } = guard();
      await expect(
        g.canActivate(context("POST", "/api/documents", DEMO_ORG, "multipart/form-data")),
      ).rejects.toThrow(/Uploads are turned off in the demo/);
    });

    it("names billing and invites, the two refusals a visitor is most likely to hit", async () => {
      const { guard: g } = guard();
      await expect(
        g.canActivate(context("POST", "/api/billing/checkout", DEMO_ORG, "application/json")),
      ).rejects.toThrow(/[Bb]illing/);
      await expect(
        g.canActivate(
          context("POST", "/api/auth/organization/invite-member", DEMO_ORG, "application/json"),
        ),
      ).rejects.toThrow(/[Ii]nviting/);
    });

    it("refuses web push, which would outlive the workspace it was allowed in", async () => {
      // PushSubscription is keyed to the browser, not the workspace, and the
      // reset does not clear it. A visitor who allowed notifications would keep
      // receiving push about LATER visitors' activity in the shared demo.
      const { guard: g } = guard();
      await expect(
        g.canActivate(context("POST", "/api/push/subscribe", DEMO_ORG, "application/json")),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("only permits writes a reset can undo", async () => {
      // The invariant behind the allowlist. Rows the reset deliberately
      // preserves -- User, Member, SystemSettings, Organization -- must not be
      // writable, or a visitor's change outlives the workspace it was made in.
      const { guard: g } = guard();
      const mustRefuse: [string, string][] = [
        ["POST", "/api/push/subscribe"],
        ["PUT", "/api/settings"],
        ["PUT", "/api/two-factor/requirement"],
        ["POST", "/api/auth/organization/update"],
        ["POST", "/api/auth/change-email"],
        ["DELETE", "/api/account"],
      ];
      for (const [method, url] of mustRefuse) {
        await expect(
          g.canActivate(context(method, url, DEMO_ORG, "application/json")),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });
  });
});
