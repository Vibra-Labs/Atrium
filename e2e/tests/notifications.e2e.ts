import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

/**
 * Notification e2e tests.
 *
 * These tests verify that operations which trigger notification emails
 * continue to succeed without error. Since Resend is not configured in
 * the e2e environment, the MailService gracefully skips sending. The
 * NotificationsService catches all errors so it never breaks the main
 * operation.
 */
test.describe("Notifications", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Notification Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    projectId = body.id;
  });

  test.describe("Project update notification", () => {
    test("creating a project update succeeds (triggers notification)", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(
        `${API}/updates?projectId=${projectId}`,
        {
          multipart: {
            content: "This update should trigger a notification email",
          },
          headers: { "x-csrf-token": csrfToken },
        },
      );
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.content).toBe(
        "This update should trigger a notification email",
      );
    });
  });

  test.describe("Task created notification", () => {
    test("creating a task succeeds (triggers notification)", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(
        `${API}/tasks?projectId=${projectId}`,
        {
          data: { title: "Notification Test Task" },
          headers: { "x-csrf-token": csrfToken },
        },
      );
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.title).toBe("Notification Test Task");
    });

    test("creating a task with due date succeeds (triggers notification)", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const res = await request.post(
        `${API}/tasks?projectId=${projectId}`,
        {
          data: {
            title: "Task With Due Date",
            dueDate: "2026-12-31",
          },
          headers: { "x-csrf-token": csrfToken },
        },
      );
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.title).toBe("Task With Due Date");
      expect(body.dueDate).toBeTruthy();
    });
  });

  test.describe("Invoice sent notification", () => {
    test("transitioning invoice to sent succeeds (triggers notification)", async ({
      request,
    }) => {
      // Create an invoice linked to the project
      const csrfToken = getCsrfToken();
      const createRes = await request.post(`${API}/invoices`, {
        data: {
          projectId,
          lineItems: [
            { description: "Notification test service", quantity: 1, unitPrice: 5000 },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(createRes.status()).toBe(201);
      const invoice = await createRes.json();
      expect(invoice.status).toBe("draft");

      // Transition to sent
      const updateRes = await request.put(`${API}/invoices/${invoice.id}`, {
        data: { status: "sent" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(updateRes.ok()).toBeTruthy();
      const updated = await updateRes.json();
      expect(updated.status).toBe("sent");
    });

    test("updating invoice without status change to sent does not break", async ({
      request,
    }) => {
      const csrfToken = getCsrfToken();
      const createRes = await request.post(`${API}/invoices`, {
        data: {
          projectId,
          lineItems: [
            { description: "No notification item", quantity: 2, unitPrice: 2500 },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(createRes.status()).toBe(201);
      const invoice = await createRes.json();

      // Update notes without changing status to sent
      const updateRes = await request.put(`${API}/invoices/${invoice.id}`, {
        data: { notes: "Updated notes" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(updateRes.ok()).toBeTruthy();
      const updated = await updateRes.json();
      expect(updated.notes).toBe("Updated notes");
      expect(updated.status).toBe("draft");
    });
  });
});
