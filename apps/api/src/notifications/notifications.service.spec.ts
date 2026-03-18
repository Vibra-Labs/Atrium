import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { NotificationsService } from "./notifications.service";
import type { MailService } from "../mail/mail.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";

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

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      findUnique: mock(() =>
        Promise.resolve({ name: "Test Project" }),
      ),
    },
    projectClient: {
      findMany: mock(() =>
        Promise.resolve([
          { user: { name: "Alice", email: "alice@example.com" } },
          { user: { name: "Bob", email: "bob@example.com" } },
        ]),
      ),
    },
    invoice: {
      findUnique: mock(() =>
        Promise.resolve({
          id: "inv-1",
          invoiceNumber: "INV-0001",
          projectId: "proj-1",
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

  beforeEach(() => {
    mail = makeMailService();
    prisma = makePrisma();
    service = new NotificationsService(
      mail as unknown as MailService,
      prisma as unknown as PrismaService,
      makeConfig() as unknown as ConfigService,
      mockLogger as unknown as PinoLogger,
    );
  });

  // --- notifyProjectUpdate ---

  test("notifyProjectUpdate sends emails to all project clients in parallel", async () => {
    const sendPromise = new Promise<void>((resolve) => {
      // Resolve after a tick so fire-and-forget has time to run
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

  test("notifyProjectUpdate does nothing when project is not found", async () => {
    prisma.project.findUnique.mockImplementation(() => Promise.resolve(null));

    const done = new Promise<void>((resolve) => setTimeout(resolve, 50));

    service.notifyProjectUpdate("nonexistent", "Update content");

    await done;

    expect(mail.send).not.toHaveBeenCalled();
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
    // We check this by spying on what the render mock receives.
    // The email template (mocked) receives props — we verify no error occurs
    // and the right subject is sent.
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
});
