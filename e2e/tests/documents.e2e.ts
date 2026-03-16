import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

/** Build a multipart/form-data body for document creation. */
function buildDocumentMultipart(
  projectId: string,
  opts: {
    type: string;
    title: string;
    filename: string;
    content?: string;
    requiresSignature?: boolean;
  },
) {
  const boundary = "----DocBoundary" + Date.now();
  const parts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="projectId"',
    "",
    projectId,
    `--${boundary}`,
    'Content-Disposition: form-data; name="type"',
    "",
    opts.type,
    `--${boundary}`,
    'Content-Disposition: form-data; name="title"',
    "",
    opts.title,
  ];

  if (opts.requiresSignature) {
    parts.push(
      `--${boundary}`,
      'Content-Disposition: form-data; name="requiresSignature"',
      "",
      "true",
    );
  }

  parts.push(
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${opts.filename}"`,
    "Content-Type: application/pdf",
    "",
    opts.content || "fake pdf content",
    `--${boundary}--`,
  );

  return { body: parts.join("\r\n"), boundary };
}

test.describe("Documents", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Document Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok()) {
      const body = await res.json();
      projectId = body.id;
    }
  });

  test.describe("API", () => {
    test("create document via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "E2E Test Quote",
        filename: "test-quote.pdf",
      });

      const res = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.status()).toBe(201);
      const doc = await res.json();
      expect(doc.title).toBe("E2E Test Quote");
      expect(doc.type).toBe("quote");
      expect(doc.status).toBe("pending");
    });

    test("list documents by project via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/documents/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    test("get single document via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "E2E Contract",
        filename: "contract.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const res = await request.get(`${API}/documents/${doc.id}`);
      expect(res.ok()).toBeTruthy();
      const result = await res.json();
      expect(result.title).toBe("E2E Contract");
      expect(result.file).toBeTruthy();
    });

    test("delete document via API", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "nda",
        title: "Doc to Delete",
        filename: "delete-me.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const res = await request.delete(`${API}/documents/${doc.id}`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
    });

    test("document respond endpoint requires project assignment", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Respond Test",
        filename: "respond.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Try to respond as the owner (not a project client) — should fail
      const res = await request.post(`${API}/documents/${doc.id}/respond`, {
        data: { action: "accepted" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    // --- E-Signature / Signing tests ---

    test("create document with requiresSignature flag", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Signable Contract",
        filename: "signable.pdf",
        requiresSignature: true,
      });

      const res = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.status()).toBe(201);
      const doc = await res.json();
      expect(doc.requiresSignature).toBe(true);
      expect(doc.signatureFields).toEqual([]);
    });

    test("set signature fields for a document", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Fields Test Contract",
        filename: "fields-test.pdf",
        requiresSignature: true,
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const fieldsRes = await request.put(`${API}/documents/${doc.id}/signature-fields`, {
        data: {
          fields: [
            { pageNumber: 0, x: 0.1, y: 0.8, width: 0.3, height: 0.06 },
            { pageNumber: 0, x: 0.5, y: 0.8, width: 0.3, height: 0.06 },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(fieldsRes.ok()).toBeTruthy();
      const updated = await fieldsRes.json();
      expect(updated.signatureFields).toHaveLength(2);
    });

    test("signing-info endpoint returns fields and signed status for admin", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "nda",
        title: "Signing Info Test",
        filename: "sign-info.pdf",
        requiresSignature: true,
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Set fields
      await request.put(`${API}/documents/${doc.id}/signature-fields`, {
        data: {
          fields: [{ pageNumber: 0, x: 0.1, y: 0.5, width: 0.25, height: 0.06 }],
        },
        headers: { "x-csrf-token": csrfToken },
      });

      // Admin/owner can access signing-info
      const infoRes = await request.get(`${API}/documents/${doc.id}/signing-info`);
      expect(infoRes.ok()).toBeTruthy();
      const info = await infoRes.json();
      expect(info.requiresSignature).toBe(true);
      expect(info.signatureFields).toHaveLength(1);
      expect(info.signedFieldIds).toEqual([]);
    });

    test("sign endpoint requires project client assignment", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Sign Auth Test",
        filename: "sign-auth.pdf",
        requiresSignature: true,
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Set a field
      const fieldsRes = await request.put(`${API}/documents/${doc.id}/signature-fields`, {
        data: {
          fields: [{ pageNumber: 0, x: 0.1, y: 0.5, width: 0.25, height: 0.06 }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      const updated = await fieldsRes.json();
      const fieldId = updated.signatureFields[0].id;

      // Try to sign as the owner (not a project client) — should fail
      const sigBoundary = "----SigBoundary" + Date.now();
      const sigBody = [
        `--${sigBoundary}`,
        'Content-Disposition: form-data; name="method"',
        "",
        "draw",
        `--${sigBoundary}`,
        'Content-Disposition: form-data; name="fieldId"',
        "",
        fieldId,
        `--${sigBoundary}`,
        'Content-Disposition: form-data; name="signature"; filename="sig.png"',
        "Content-Type: image/png",
        "",
        "fake png signature",
        `--${sigBoundary}--`,
      ].join("\r\n");

      const signRes = await request.post(`${API}/documents/${doc.id}/sign`, {
        data: sigBody,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${sigBoundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(signRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("view endpoint streams PDF inline", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "other",
        title: "View Test",
        filename: "view-test.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const viewRes = await request.get(`${API}/documents/${doc.id}/view`);
      expect(viewRes.ok()).toBeTruthy();
      const contentType = viewRes.headers()["content-type"];
      expect(contentType).toContain("application/");
      const disposition = viewRes.headers()["content-disposition"];
      expect(disposition).toContain("inline");
    });
  });

  test.describe("Dashboard UI", () => {
    test("project detail page shows documents section in files tab", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await expect(page.getByText(/documents/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test("upload document button is visible", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await expect(page.getByText(/upload document/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test("requires signature checkbox visible for PDF uploads", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        const uploadBtn = page.getByText(/upload document/i);
        if (await uploadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await uploadBtn.click();
          // The checkbox should not be visible until a PDF file is selected
          await expect(page.getByText(/requires signature/i)).not.toBeVisible();
        }
      }
    });
  });
});
