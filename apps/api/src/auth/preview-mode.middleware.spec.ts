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

  it("ignores X-Preview-As header on /api/auth/* routes", async () => {
    const prisma = buildPrismaMock({
      userId: "client-9",
      role: "member",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({
      headers: { "x-preview-as": "client-9" },
      originalUrl: "/api/auth/get-session",
    });
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(req as Request, {} as Response, next);

    expect(req.user?.id).toBe("owner-1");
    expect(req.previewMode).toBeUndefined();
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
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

  it("uses first value when X-Preview-As header is an array", async () => {
    const prisma = buildPrismaMock({
      userId: "client-9",
      role: "member",
      organizationId: "org-1",
    });
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq() as MockReq & { headers: Record<string, string | string[]> };
    req.headers["x-preview-as"] = ["client-9", "ignored-second-value"];
    const next = mock(() => {}) as unknown as NextFunction;

    await mw.use(req as unknown as Request, {} as Response, next);

    expect(req.user?.id).toBe("client-9");
    expect(req.previewMode).toBe(true);
  });

  it("rejects with 401 when requester has no member context", async () => {
    const prisma = buildPrismaMock(null);
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({
      headers: { "x-preview-as": "client-9" },
      member: undefined,
    });
    const next = mock(() => {}) as unknown as NextFunction;

    await expect(mw.use(req as Request, {} as Response, next)).rejects.toThrow(
      "Preview unavailable",
    );
  });

  it("rejects with 401 when requester has no organization context", async () => {
    const prisma = buildPrismaMock(null);
    const mw = new PreviewModeMiddleware(prisma as any);
    const req = buildReq({
      headers: { "x-preview-as": "client-9" },
      organization: undefined,
    });
    const next = mock(() => {}) as unknown as NextFunction;

    await expect(mw.use(req as Request, {} as Response, next)).rejects.toThrow(
      "Preview unavailable",
    );
  });
});
