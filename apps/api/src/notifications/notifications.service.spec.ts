import { describe, test, expect, beforeEach, mock } from "bun:test";
import { NotificationsService } from "./notifications.service";
import type { MailService } from "../mail/mail.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import type { InAppNotificationsService } from "./in-app-notifications.service";
import type { PushService } from "./push.service";

// --- Module mocks ---

// Mock @atrium/email render functions so tests never call React Email
mock.module("@atrium/email", () => ({
  ProjectUpdateEmail: (props: Record<string, unknown>) => props,
  TaskAssignedEmail: (props: Record<string, unknown>) => props,
  InvoiceSentEmail: (props: Record<string, unknown>) => props,
  DecisionClosedEmail: (props: Record<string, unknown>) => props,
  DocumentUploadedEmail: (props: Record<string, unknown>) => props,
  DocumentRespondedEmail: (props: Record<string, unknown>) => props,
}));

mock.module("@react-email/render", () => ({
  render: mock(async () => "<html>email</html>"),
}));

// --- Helpers ---

const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

function makeMailService() {
  return {
    send: mock(() => Promise.resolve()),
  };
}

function makeConfig() {
  return {
    get: (key: string, fallback?: string) => {
      if (key === "WEB_URL") return "http://localhost:3000";
      return fallback;
    },
  };
}

function makeInAppService() {
  return {
    create: mock(() => Promise.resolve()),
    createMany: mock(() => Promise.resolve()),
    findByUser: mock(() => Promise.resolve({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })),
    unreadCount: mock(() => Promise.resolve(0)),
    markRead: mock(() => Promise.resolve()),
    markAllRead: mock(() => Promise.resolve()),
  };
}

function makePushService() {
  return {
    sendToUser: mock(() => Promise.resolve()),
    sendToMany: mock(() => Promise.resolve()),
    isEnabled: mock(() => Promise.resolve(false)),
    getPublicKey: mock(() => Promise.resolve("test-key")),
    subscribe: mock(() => Promise.resolve()),
    unsubscribe: mock(() => Promise.resolve()),
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      findUnique: mock(() =>
        Promise.resolve({ name: "Test Project", organizationId: "org-1" }),
      ),
    },
    projectClient: {
      findMany: mock(() =>
        Promise.resolve([
          { user: { id: "user-1", name: "Alice", email: "alice@example.com" } },
          { user: { id: "user-2", name: "Bob", email: "bob@example.com" } },
        ]),
      ),
    },
    invoice: {
      findUnique: mock(() =>
        Promise.resolve({
          id: "inv-1",
          invoiceNumber: "INV-0001",
          projectId: "proj-1",
          organizationId: "org-1",
          type: "itemized",
          dueDate: new Date("2025-03-01"),
          lineItems: [
            { quantity: 2, unitPrice: 5000 },
            { quantity: 1, unitPrice: 3000 },
          ],
        }),
      ),
    },
    ...overrides,
  };
}

describe("NotificationsService", () => {
  let service: NotificationsService;
  let mail: ReturnType<typeof makeMailService>;
  let prisma: ReturnType<typeof makePrisma>;
  let inApp: ReturnType<typeof makeInAppService>;
  let push: ReturnType<typeof makePushService>;

  beforeEach(() => {
    mail = makeMailService();
    prisma = makePrisma();
    inApp = makeInAppService();
    push = makePushService();
    service = new NotificationsService(
      mail as unknown as MailService,
      prisma as unknown as PrismaService,
      makeConfig() as unknown as ConfigService,
      inApp as unknown as InAppNotificationsService,
      push as unknown as PushService,
      mockLogger as unknown as PinoLogger,
    );
  });

  // --- notifyProjectUpdate ---

  test("notifyProjectUpdate sends emails to all project clients in parallel", async () => {
    const sendPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    service.notifyProjectUpdate("proj-1", "We finished the homepage");

    await sendPromise;

    expect(mail.send).toHaveBeenCalledTimes(2);

    const calls = mail.send.mock.calls;
    const recipients = calls.map((c: unknown[]) => c[0]);
    expect(recipients).toContain("alice@example.com");
    expect(recipients).toContain("bob@example.com");
  });

  test("notifyProjectUpdate creates in-app notifications", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "We finished the homepage");

    await done;

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
  });

  test("notifyProjectUpdate sends push notifications", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "We finished the homepage");

    await done;

    expect(push.sendToMany).toHaveBeenCalledTimes(1);
  });

  test("notifyProjectUpdate does nothing when project is not found", async () => {
    prisma.project.findUnique.mockImplementation(() => Promise.resolve(null));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("nonexistent", "Update content");

    await done;

    expect(mail.send).not.toHaveBeenCalled();
    expect(inApp.createMany).not.toHaveBeenCalled();
  });

  test("notifyProjectUpdate does nothing when project has no clients", async () => {
    prisma.projectClient.findMany.mockImplementation(() => Promise.resolve([]));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "Update content");

    await done;

    expect(mail.send).not.toHaveBeenCalled();
  });

  test("notifyProjectUpdate is fire-and-forget — does not throw on email failure", async () => {
    mail.send.mockImplementation(() => Promise.reject(new Error("SMTP error")));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Must not throw synchronously
    expect(() => service.notifyProjectUpdate("proj-1", "Update")).not.toThrow();

    await done;
    // Logger should have warned
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  // --- notifyTaskCreated ---

  test("notifyTaskCreated sends emails with task title to all clients", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyTaskCreated("proj-1", "Design homepage hero section");

    await done;

    expect(mail.send).toHaveBeenCalledTimes(2);

    const subjectCall = mail.send.mock.calls[0];
    expect(subjectCall[1]).toContain("Design homepage hero section");
  });

  test("notifyTaskCreated includes due date when provided", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    const dueDate = new Date("2025-06-15");
    service.notifyTaskCreated("proj-1", "Deploy to production", dueDate);

    await done;

    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  test("notifyTaskCreated is fire-and-forget — does not throw when emails fail", async () => {
    mail.send.mockImplementation(() => Promise.reject(new Error("Connection refused")));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(() =>
      service.notifyTaskCreated("proj-1", "New task", new Date()),
    ).not.toThrow();

    await done;
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  // --- notifyInvoiceSent ---

  test("notifyInvoiceSent sends emails to all project clients", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyInvoiceSent("inv-1");

    await done;

    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  test("notifyInvoiceSent calculates correct total from line items (in cents)", async () => {
    // lineItems: [2 * 5000, 1 * 3000] = 13000 cents = $130.00
    let capturedSubject = "";

    mail.send.mockImplementation(async (_to: string, subject: string) => {
      capturedSubject = subject;
    });

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyInvoiceSent("inv-1");

    await done;

    // Subject should contain the amount formatted as dollars
    expect(capturedSubject).toContain("$130.00");
  });

  test("notifyInvoiceSent does nothing when invoice is not found", async () => {
    prisma.invoice.findUnique.mockImplementation(() => Promise.resolve(null));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyInvoiceSent("nonexistent");

    await done;

    expect(mail.send).not.toHaveBeenCalled();
  });

  test("notifyInvoiceSent does nothing when invoice has no projectId", async () => {
    prisma.invoice.findUnique.mockImplementation(() =>
      Promise.resolve({
        id: "inv-2",
        invoiceNumber: "INV-0002",
        projectId: null,
        organizationId: "org-1",
        type: "itemized",
        dueDate: null,
        lineItems: [],
      }),
    );

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyInvoiceSent("inv-2");

    await done;

    expect(mail.send).not.toHaveBeenCalled();
  });

  test("notifyInvoiceSent failure for one client does not prevent others", async () => {
    // First send throws, second succeeds
    let sendCount = 0;
    mail.send.mockImplementation(async () => {
      sendCount += 1;
      if (sendCount === 1) throw new Error("Recipient rejected");
    });

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyInvoiceSent("inv-1");

    await done;

    // Both were attempted (Promise.allSettled ensures non-blocking)
    expect(sendCount).toBe(2);
  });

  test("notifyInvoiceSent is fire-and-forget — does not throw on failure", async () => {
    mail.send.mockImplementation(() => Promise.reject(new Error("Network failure")));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(() => service.notifyInvoiceSent("inv-1")).not.toThrow();

    await done;
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  // --- createInAppAndPush argument verification ---

  test("notifyProjectUpdate passes correct in-app notification data", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "Short update");

    await done;

    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall).toHaveLength(2); // Two clients
    expect(createCall[0]).toMatchObject({
      userId: "user-1",
      organizationId: "org-1",
      type: "project_update",
      title: "New update on Test Project",
      message: "Short update",
      link: "/portal/projects/proj-1",
    });
  });

  test("notifyProjectUpdate truncates long messages to 100 chars", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));
    const longContent = "A".repeat(150);

    service.notifyProjectUpdate("proj-1", longContent);

    await done;

    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall[0].message).toBe("A".repeat(100) + "…");
  });

  test("notifyProjectUpdate passes correct push payload", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "Push test");

    await done;

    expect(push.sendToMany).toHaveBeenCalledTimes(1);
    const [userIds, orgId, payload] = push.sendToMany.mock.calls[0];
    expect(userIds).toEqual(["user-1", "user-2"]);
    expect(orgId).toBe("org-1");
    expect(payload).toMatchObject({
      title: "New update on Test Project",
      message: "Push test",
      link: "/portal/projects/proj-1",
    });
  });

  test("notifyTaskCreated creates in-app notifications with task title as message", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyTaskCreated("proj-1", "Design hero section");

    await done;

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall[0]).toMatchObject({
      type: "task_created",
      title: "New task on Test Project",
      message: "Design hero section",
      link: "/portal/projects/proj-1",
    });
  });

  test("notifyInvoiceSent creates in-app notifications with amount and due date", async () => {
    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyInvoiceSent("inv-1");

    await done;

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall[0]).toMatchObject({
      type: "invoice_sent",
      title: "Invoice INV-0001",
    });
    expect(createCall[0].message).toContain("$130.00");
  });

  // --- notifyComment ---

  test("notifyComment from client notifies org owners/admins", async () => {
    // Mock member lookup for admins
    (prisma as any).member = {
      findMany: mock(() =>
        Promise.resolve([
          { userId: "admin-1" },
          { userId: "admin-2" },
        ]),
      ),
    };

    await service.notifyComment(
      "proj-1",
      "org-1",
      "client-1",
      "member",
      "Client comment content",
      "update",
    );

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall).toHaveLength(2);
    expect(createCall[0]).toMatchObject({
      userId: "admin-1",
      organizationId: "org-1",
      type: "comment",
      link: "/dashboard/projects/proj-1",
    });
    expect(createCall[0].message).toBe("Client comment content");
  });

  test("notifyComment from admin on an update notifies project clients (excluding author)", async () => {
    await service.notifyComment(
      "proj-1",
      "org-1",
      "user-1", // admin who is also in the client list
      "admin",
      "Admin reply",
      "update",
    );

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    // user-1 is excluded because they're the author, so only user-2
    expect(createCall).toHaveLength(1);
    expect(createCall[0]).toMatchObject({
      userId: "user-2",
      type: "comment",
      link: "/portal/projects/proj-1",
    });
  });

  test("notifyComment from admin on a task notifies the task requester only", async () => {
    (prisma as any).member = {
      findFirst: mock(() =>
        Promise.resolve({ role: "member" }), // requester is a portal client
      ),
    };

    await service.notifyComment(
      "proj-1",
      "org-1",
      "admin-1",
      "admin",
      "Admin reply on task",
      "task",
      { requestedById: "client-1", assigneeId: null },
    );

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall).toHaveLength(1);
    expect(createCall[0]).toMatchObject({
      userId: "client-1",
      type: "comment",
      link: "/portal/projects/proj-1",
    });
  });

  test("notifyComment from admin on a task with no requester falls back to project clients", async () => {
    await service.notifyComment(
      "proj-1",
      "org-1",
      "admin-1",
      "admin",
      "Reply on agency-owned task",
      "task",
      { requestedById: null, assigneeId: null },
    );

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    const recipientIds = createCall.map((n: { userId: string }) => n.userId).sort();
    expect(recipientIds).toEqual(["user-1", "user-2"]);
    expect(createCall[0]).toMatchObject({
      type: "comment",
      link: "/portal/projects/proj-1",
    });
  });

  test("notifyComment from client on a task notifies assignee + admins (dedup, exclude author)", async () => {
    (prisma as any).member = {
      findMany: mock(() =>
        Promise.resolve([{ userId: "admin-1" }, { userId: "admin-2" }]),
      ),
    };

    await service.notifyComment(
      "proj-1",
      "org-1",
      "client-1",
      "member",
      "Client comment on task",
      "task",
      { requestedById: "client-1", assigneeId: "admin-1" },
    );

    expect(inApp.createMany).toHaveBeenCalledTimes(1);
    const createCall = inApp.createMany.mock.calls[0][0];
    const userIds = createCall.map((n: { userId: string }) => n.userId);
    // assignee + admins, deduplicated, author excluded
    expect(userIds.sort()).toEqual(["admin-1", "admin-2"]);
    expect(createCall[0]).toMatchObject({
      type: "comment",
      link: "/dashboard/projects/proj-1",
    });
  });

  test("notifyComment does nothing when project not found", async () => {
    prisma.project.findUnique.mockImplementation(() => Promise.resolve(null));

    await service.notifyComment(
      "nonexistent",
      "org-1",
      "user-1",
      "admin",
      "Comment",
      "update",
    );

    expect(inApp.createMany).not.toHaveBeenCalled();
  });

  test("notifyComment truncates long content to 100 chars", async () => {
    const longContent = "B".repeat(150);

    await service.notifyComment(
      "proj-1",
      "org-1",
      "user-1",
      "admin",
      longContent,
      "update",
    );

    const createCall = inApp.createMany.mock.calls[0][0];
    expect(createCall[0].message).toBe("B".repeat(100) + "…");
  });

  // --- in-app/push failure isolation ---

  test("in-app failure does not prevent email sending", async () => {
    inApp.createMany.mockImplementation(() => Promise.reject(new Error("DB error")));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "Update despite in-app failure");

    await done;

    // Emails should still be sent
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  test("push failure does not prevent email sending", async () => {
    push.sendToMany.mockImplementation(() => Promise.reject(new Error("Push error")));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("proj-1", "Update despite push failure");

    await done;

    expect(mail.send).toHaveBeenCalledTimes(2);
  });
});
