import { describe, test, expect, beforeEach, mock } from "bun:test";
import { InAppNotificationsService } from "./in-app-notifications.service";
import type { PrismaService } from "../prisma/prisma.service";

function makePrisma() {
  return {
    notification: {
      create: mock(() =>
        Promise.resolve({
          id: "notif-1",
          userId: "user-1",
          organizationId: "org-1",
          type: "project_update",
          title: "Test",
          message: "Hello",
          link: "/portal/projects/1",
          read: false,
          createdAt: new Date(),
        }),
      ),
      createMany: mock(() => Promise.resolve({ count: 2 })),
      findMany: mock(() =>
        Promise.resolve([
          {
            id: "notif-1",
            userId: "user-1",
            organizationId: "org-1",
            type: "project_update",
            title: "Test",
            message: "Hello",
            link: "/portal/projects/1",
            read: false,
            createdAt: new Date(),
          },
        ]),
      ),
      count: mock(() => Promise.resolve(1)),
      updateMany: mock(() => Promise.resolve({ count: 1 })),
    },
  };
}

describe("InAppNotificationsService", () => {
  let service: InAppNotificationsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new InAppNotificationsService(prisma as unknown as PrismaService);
  });

  // --- create ---

  test("create calls prisma.notification.create with correct data", async () => {
    const data = {
      userId: "user-1",
      organizationId: "org-1",
      type: "project_update",
      title: "Test",
      message: "Hello",
      link: "/portal/projects/1",
    };
    await service.create(data);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create.mock.calls[0][0]).toEqual({ data });
  });

  // --- createMany ---

  test("createMany calls prisma.notification.createMany with array", async () => {
    const notifications = [
      { userId: "user-1", organizationId: "org-1", type: "test", title: "A", message: "a" },
      { userId: "user-2", organizationId: "org-1", type: "test", title: "B", message: "b" },
    ];
    await service.createMany(notifications);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany.mock.calls[0][0]).toEqual({ data: notifications });
  });

  test("createMany does nothing for empty array", async () => {
    await service.createMany([]);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  // --- findByUser ---

  test("findByUser returns paginated response with meta", async () => {
    const result = await service.findByUser("user-1", "org-1", 1, 10);
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("meta");
    expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(result.data).toHaveLength(1);
  });

  test("findByUser queries with correct where, orderBy, and pagination", async () => {
    await service.findByUser("user-1", "org-1", 2, 5);
    const findCall = prisma.notification.findMany.mock.calls[0][0];
    expect(findCall.where).toEqual({ userId: "user-1", organizationId: "org-1" });
    expect(findCall.orderBy).toEqual({ createdAt: "desc" });
    expect(findCall.skip).toBe(5); // (page 2 - 1) * limit 5
    expect(findCall.take).toBe(5);
  });

  test("findByUser uses default page=1 and limit=10", async () => {
    await service.findByUser("user-1", "org-1");
    const findCall = prisma.notification.findMany.mock.calls[0][0];
    expect(findCall.skip).toBe(0);
    expect(findCall.take).toBe(10);
  });

  // --- unreadCount ---

  test("unreadCount filters by userId, orgId, and read=false", async () => {
    const count = await service.unreadCount("user-1", "org-1");
    expect(count).toBe(1);
    expect(prisma.notification.count).toHaveBeenCalledTimes(1);
    const countCall = prisma.notification.count.mock.calls[0][0];
    expect(countCall.where).toEqual({ userId: "user-1", organizationId: "org-1", read: false });
  });

  // --- markRead ---

  test("markRead scopes by id, userId, and organizationId", async () => {
    await service.markRead("notif-1", "user-1", "org-1");
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.notification.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "notif-1", userId: "user-1", organizationId: "org-1" });
    expect(call.data).toEqual({ read: true });
  });

  test("markRead cannot mark another user's notification", async () => {
    // The where clause includes userId, so a different userId would match nothing
    await service.markRead("notif-1", "other-user", "org-1");
    const call = prisma.notification.updateMany.mock.calls[0][0];
    expect(call.where.userId).toBe("other-user");
  });

  // --- markAllRead ---

  test("markAllRead only targets unread notifications for the user+org", async () => {
    await service.markAllRead("user-1", "org-1");
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.notification.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: "user-1", organizationId: "org-1", read: false });
    expect(call.data).toEqual({ read: true });
  });
});
