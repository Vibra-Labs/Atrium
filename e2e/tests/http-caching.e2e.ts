import { test, expect } from "@playwright/test";
import { getCsrfToken, getOrCreateProject } from "./helpers";

// These run against the API directly (not through Caddy), so they assert what
// the API itself sends. Caddy only adds no-store when the API sent nothing.
const API = "http://localhost:3001/api";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("HTTP caching", () => {
  test("logo is immutable with a key and short-lived without", async ({ request }) => {
    const csrf = getCsrfToken();
    const upload = await request.post(`${API}/branding/logo`, {
      multipart: { logo: { name: "logo.png", mimeType: "image/png", buffer: PNG_1X1 } },
      headers: { "x-csrf-token": csrf },
    });
    expect(upload.ok()).toBe(true);
    const branding = (await upload.json()) as { logoKey: string; organizationId: string };

    try {
      const keyed = await request.get(
        `${API}/branding/logo/${branding.organizationId}?k=${encodeURIComponent(branding.logoKey)}`,
      );
      expect(keyed.status()).toBe(200);
      expect(keyed.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");

      const unkeyed = await request.get(`${API}/branding/logo/${branding.organizationId}`);
      expect(unkeyed.status()).toBe(200);
      expect(unkeyed.headers()["cache-control"]).toBe("public, max-age=60");
    } finally {
      await request.delete(`${API}/branding/logo`, { headers: { "x-csrf-token": csrf } });
    }
  });

  test("file downloads and update attachments are private-cached and uncompressed; JSON is not cached", async ({
    request,
  }) => {
    const projectId: string = await getOrCreateProject(request, "HTTP Caching Project");
    const text: string = "cache me ".repeat(500);
    const updateRes = await request.post(`${API}/updates?projectId=${projectId}`, {
      multipart: {
        content: "Update with attachment for caching test",
        attachment: { name: "cache.txt", mimeType: "text/plain", buffer: Buffer.from(text) },
      },
      headers: { "x-csrf-token": getCsrfToken() },
    });
    expect(updateRes.ok()).toBe(true);
    const update = (await updateRes.json()) as { id: string; fileId: string };

    const file = await request.get(`${API}/files/${update.fileId}/download`, {
      headers: { "accept-encoding": "gzip" },
    });
    expect(file.status()).toBe(200);
    expect(file.headers()["cache-control"]).toBe("private, max-age=3600");
    expect(file.headers()["content-encoding"]).toBeUndefined();

    const attachment = await request.get(`${API}/updates/${update.id}/attachment`, {
      headers: { "accept-encoding": "gzip" },
    });
    expect(attachment.status()).toBe(200);
    expect(attachment.headers()["cache-control"]).toBe("private, max-age=3600");
    expect(attachment.headers()["content-encoding"]).toBeUndefined();

    // JSON must not pick up a cacheable header from the API; Caddy then adds no-store.
    const list = await request.get(`${API}/files/project/${projectId}`);
    expect(list.status()).toBe(200);
    expect(list.headers()["cache-control"] ?? "").not.toMatch(/max-age|public/);
  });
});
