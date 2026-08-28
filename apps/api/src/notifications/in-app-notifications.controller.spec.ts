import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { InAppNotificationsController } from "./in-app-notifications.controller";
import type { InAppNotificationsService } from "./in-app-notifications.service";

/**
 * A session has no active organization between signing in and the web app's
 * set-active call (see apps/web/src/lib/api.ts), and API-only clients may
 * never set one at all. The session middleware leaves req.organization
 * undefined in that window, so every endpoint here has to cope with it —
 * previously they threw and the notification bell 500'd on each login.
 */
describe("InAppNotificationsController without an active organization", () => {
  const service = {
    findByUser: mock(() =>
      Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
    ),
    unreadCount: mock(() => Promise.resolve(3)),
    markAllRead: mock(() => Promise.resolve({ count: 1 })),
    markRead: mock(() => Promise.resolve({ id: "n1" })),
  };
  const controller = new InAppNotificationsController(
    service as unknown as InAppNotificationsService,
  );
  const noOrgReq = { user: { id: "u1" } };

  beforeEach(() => {
    service.findByUser.mockClear();
    service.unreadCount.mockClear();
    service.markAllRead.mockClear();
    service.markRead.mockClear();
  });

  it("unreadCount returns zero instead of throwing", async () => {
    expect(await controller.unreadCount(noOrgReq)).toEqual({ count: 0 });
    expect(service.unreadCount).not.toHaveBeenCalled();
  });

  it("list returns an empty page instead of throwing", async () => {
    const result = await controller.list({ page: 1, limit: 10 }, noOrgReq);

    expect(result).toMatchObject({ data: [], meta: { total: 0 } });
    expect(service.findByUser).not.toHaveBeenCalled();
  });

  it("markAllRead rejects rather than silently doing nothing", async () => {
    expect(() => controller.markAllRead(noOrgReq)).toThrow(
      BadRequestException,
    );
    expect(service.markAllRead).not.toHaveBeenCalled();
  });

  it("markRead rejects rather than silently doing nothing", async () => {
    expect(() => controller.markRead("n1", noOrgReq)).toThrow(
      BadRequestException,
    );
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it("still delegates normally when an organization is present", async () => {
    const req = { user: { id: "u1" }, organization: { id: "org-1" } };

    expect(await controller.unreadCount(req)).toEqual({ count: 3 });
    expect(service.unreadCount).toHaveBeenCalledWith("u1", "org-1");
  });
});
