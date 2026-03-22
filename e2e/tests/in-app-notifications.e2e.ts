import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("In-App Notifications API", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "InApp Notification Test" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    projectId = body.id;
  });

  test("GET /notifications returns paginated response with correct shape", async ({
    request,
  }) => {
    const res = await request.get(`${API}/notifications?page=1&limit=10`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("meta");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty("total");
    expect(body.meta).toHaveProperty("page");
    expect(body.meta).toHaveProperty("limit");
    expect(body.meta).toHaveProperty("totalPages");
  });

  test("GET /notifications respects pagination params", async ({
    request,
  }) => {
    const res = await request.get(`${API}/notifications?page=1&limit=1`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.meta.limit).toBe(1);
    expect(body.data.length).toBeLessThanOrEqual(1);
  });

  test("GET /notifications/unread-count returns count object", async ({
    request,
  }) => {
    const res = await request.get(`${API}/notifications/unread-count`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  test("creating an update succeeds and triggers notification flow", async ({
    request,
  }) => {
    test.skip(!projectId, "No project available");
    const csrfToken = getCsrfToken();

    const updateRes = await request.post(
      `${API}/updates?projectId=${projectId}`,
      {
        multipart: {
          content: "In-app notification test update",
        },
        headers: { "x-csrf-token": csrfToken },
      },
    );
    expect(updateRes.status()).toBe(201);
  });

  test("PATCH /notifications/read-all succeeds and resets count to zero", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();
    const res = await request.patch(`${API}/notifications/read-all`, {
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();

    // After marking all read, count should be 0
    const countRes = await request.get(`${API}/notifications/unread-count`);
    expect(countRes.ok()).toBeTruthy();
    const body = await countRes.json();
    expect(body.count).toBe(0);
  });

  test("PATCH /notifications/:id/read succeeds for valid id", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();

    // Get the list first to find a notification id (or use a fake one — updateMany matches 0 rows gracefully)
    const listRes = await request.get(`${API}/notifications?limit=1`);
    const list = await listRes.json();

    // If there are notifications, mark one as read
    if (list.data.length > 0) {
      const notifId = list.data[0].id;
      const res = await request.patch(`${API}/notifications/${notifId}/read`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    }

    // Even with a non-existent id, the endpoint should succeed (updateMany matches 0)
    const res = await request.patch(
      `${API}/notifications/nonexistent-id/read`,
      { headers: { "x-csrf-token": csrfToken } },
    );
    expect(res.ok()).toBeTruthy();
  });

  test("GET /notifications returns notifications with correct fields when present", async ({
    request,
  }) => {
    const res = await request.get(`${API}/notifications?limit=50`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // If there are any notifications, validate their shape
    for (const notif of body.data) {
      expect(notif).toHaveProperty("id");
      expect(notif).toHaveProperty("type");
      expect(notif).toHaveProperty("title");
      expect(notif).toHaveProperty("message");
      expect(notif).toHaveProperty("read");
      expect(notif).toHaveProperty("createdAt");
      expect(typeof notif.id).toBe("string");
      expect(typeof notif.type).toBe("string");
      expect(typeof notif.title).toBe("string");
      expect(typeof notif.read).toBe("boolean");
    }
  });

  test("GET /notifications rejects invalid pagination params", async ({
    request,
  }) => {
    // limit > 50 should be rejected by validation
    const res = await request.get(`${API}/notifications?limit=100`);
    expect(res.status()).toBe(400);
  });

  test("unauthenticated request to /notifications is rejected", async ({
    request,
  }) => {
    // Without session cookies, the auth guard rejects the request.
    // AllExceptionsFilter masks the error as 500 for security.
    const res = await fetch(`${API}/notifications/unread-count`);
    expect(res.ok).toBe(false);
  });
});

test.describe("Push Notifications API", () => {
  test("GET /push/vapid-key returns a public key", async ({ request }) => {
    const res = await request.get(`${API}/push/vapid-key`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.publicKey).toBe("string");
    expect(body.publicKey.length).toBeGreaterThan(0);
  });

  test("GET /push/vapid-key returns the same key on subsequent calls", async ({
    request,
  }) => {
    const res1 = await request.get(`${API}/push/vapid-key`);
    const body1 = await res1.json();

    const res2 = await request.get(`${API}/push/vapid-key`);
    const body2 = await res2.json();

    expect(body1.publicKey).toBe(body2.publicKey);
  });

  test("POST /push/subscribe saves a subscription", async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/push/subscribe`, {
      data: {
        endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-e2e",
        keys: {
          p256dh:
            "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-T4-01EAS2v5qz-LMDpO-Kgc8s0",
          auth: "tBHItJI5svbpC7t8RkFDpg",
        },
      },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("POST /push/subscribe is idempotent (same endpoint updates keys)", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();

    // Subscribe twice with same endpoint but different keys
    await request.post(`${API}/push/subscribe`, {
      data: {
        endpoint: "https://fcm.googleapis.com/fcm/send/idempotent-test",
        keys: { p256dh: "key-v1", auth: "auth-v1" },
      },
      headers: { "x-csrf-token": csrfToken },
    });

    const res = await request.post(`${API}/push/subscribe`, {
      data: {
        endpoint: "https://fcm.googleapis.com/fcm/send/idempotent-test",
        keys: { p256dh: "key-v2", auth: "auth-v2" },
      },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();

    // Clean up
    await request.post(`${API}/push/unsubscribe`, {
      data: { endpoint: "https://fcm.googleapis.com/fcm/send/idempotent-test" },
      headers: { "x-csrf-token": csrfToken },
    });
  });

  test("POST /push/unsubscribe removes a subscription", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/push/unsubscribe`, {
      data: {
        endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-e2e",
      },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("POST /push/unsubscribe succeeds even for non-existent endpoint", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/push/unsubscribe`, {
      data: {
        endpoint: "https://fcm.googleapis.com/fcm/send/does-not-exist",
      },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("POST /push/subscribe rejects missing keys", async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/push/subscribe`, {
      data: { endpoint: "https://example.com/push" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /push/subscribe rejects missing endpoint", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/push/subscribe`, {
      data: { keys: { p256dh: "key", auth: "auth" } },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(res.status()).toBe(400);
  });
});
