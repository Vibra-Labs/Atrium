import { describe, expect, it, mock } from "bun:test";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { DemoGuard } from "./demo.guard";
import type { DemoService } from "./demo.service";

const DEMO_ORG = "org-demo";

function context(method: string, url: string, organizationId?: string): ExecutionContext {
  const request = { method, originalUrl: url, organization: organizationId ? { id: organizationId } : undefined };
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

  it("does not record activity on a read", async () => {
    const { guard: g, touch } = guard();
    await g.canActivate(context("GET", "/api/projects", DEMO_ORG));
    expect(touch).not.toHaveBeenCalled();
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
    expect(await g.canActivate(context("POST", "/api/demo/reset", DEMO_ORG))).toBe(true);
  });
});
