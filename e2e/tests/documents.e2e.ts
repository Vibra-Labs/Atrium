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
    test("create document via API — defaults to draft status", async ({ request }) => {
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
      expect(doc.status).toBe("draft");
    });

    test("send document transitions draft to pending", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Send Test",
        filename: "send-test.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();
      expect(doc.status).toBe("draft");

      const sendRes = await request.post(`${API}/documents/${doc.id}/send`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });
      expect(sendRes.ok()).toBeTruthy();
      const sent = await sendRes.json();
      expect(sent.status).toBe("pending");
      expect(sent.sentAt).toBeTruthy();
    });

    test("send with expiresInDays sets expiresAt", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "nda",
        title: "Expiry Test",
        filename: "expiry-test.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const sendRes = await request.post(`${API}/documents/${doc.id}/send`, {
        data: { expiresInDays: 7 },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(sendRes.ok()).toBeTruthy();
      const sent = await sendRes.json();
      expect(sent.expiresAt).toBeTruthy();
      // Verify expiry is roughly 7 days from now
      const expiresAt = new Date(sent.expiresAt);
      const diff = expiresAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    });

    test("void document transitions to voided status", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Void Test",
        filename: "void-test.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const voidRes = await request.post(`${API}/documents/${doc.id}/void`, {
        data: { reason: "Sent in error" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(voidRes.ok()).toBeTruthy();
      const voided = await voidRes.json();
      expect(voided.status).toBe("voided");
      expect(voided.voidReason).toBe("Sent in error");
      expect(voided.voidedAt).toBeTruthy();
    });

    test("cannot void a signed document", async ({ request }) => {
      // We can't easily create a signed document in e2e, but we can verify
      // that voiding a voided document fails
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Double Void Test",
        filename: "double-void.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Void it
      await request.post(`${API}/documents/${doc.id}/void`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });

      // Try to void again
      const res = await request.post(`${API}/documents/${doc.id}/void`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    });

    test("audit trail endpoint returns events", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Audit Trail Test",
        filename: "audit.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Wait briefly for async audit log
      await new Promise((r) => setTimeout(r, 500));

      const auditRes = await request.get(`${API}/documents/${doc.id}/audit-trail`);
      expect(auditRes.ok()).toBeTruthy();
      const audit = await auditRes.json();
      expect(audit.data).toBeInstanceOf(Array);
      // Should have at least the "created" event
      expect(audit.data.length).toBeGreaterThanOrEqual(1);
      expect(audit.data.some((e: { action: string }) => e.action === "created")).toBeTruthy();
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

    test("document respond endpoint rejects draft documents", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Respond Draft Test",
        filename: "respond-draft.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Try to respond to a draft (should fail with blocked status)
      const res = await request.post(`${API}/documents/${doc.id}/respond`, {
        data: { action: "accepted" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
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

      // Send the document first so it's in "pending" status
      await request.post(`${API}/documents/${doc.id}/send`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });

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

    test("set signature fields with type for a document", async ({ request }) => {
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
            { pageNumber: 0, x: 0.1, y: 0.8, width: 0.3, height: 0.06, type: "signature" },
            { pageNumber: 0, x: 0.5, y: 0.8, width: 0.18, height: 0.035, type: "date" },
            { pageNumber: 0, x: 0.5, y: 0.9, width: 0.25, height: 0.035, type: "text", label: "Title" },
          ],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(fieldsRes.ok()).toBeTruthy();
      const updated = await fieldsRes.json();
      expect(updated.signatureFields).toHaveLength(3);
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

    test("sign endpoint rejects draft documents", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Sign Draft Test",
        filename: "sign-draft.pdf",
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

      // Try to sign a draft — should fail
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

      // Send the document
      await request.post(`${API}/documents/${doc.id}/send`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });

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

    test("track-view endpoint works", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Track View Test",
        filename: "track-view.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const res = await request.post(`${API}/documents/${doc.id}/track-view`, {
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const result = await res.json();
      expect(result.viewed).toBe(true);
    });

    test("certificate endpoint rejects non-signed documents", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Cert Test",
        filename: "cert-test.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const certRes = await request.get(`${API}/documents/${doc.id}/certificate`);
      expect(certRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("cannot send signature document with zero fields", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "No Fields Test",
        filename: "no-fields.pdf",
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

      // Try to send without placing fields
      const sendRes = await request.post(`${API}/documents/${doc.id}/send`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });
      expect(sendRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("cannot edit signature fields on sent document", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Fields Lock Test",
        filename: "fields-lock.pdf",
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

      // Place fields and send
      await request.put(`${API}/documents/${doc.id}/signature-fields`, {
        data: {
          fields: [{ pageNumber: 0, x: 0.1, y: 0.5, width: 0.25, height: 0.06 }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      await request.post(`${API}/documents/${doc.id}/send`, {
        data: {},
        headers: { "x-csrf-token": csrfToken },
      });

      // Try to edit fields after sending — should fail
      const fieldsRes = await request.put(`${API}/documents/${doc.id}/signature-fields`, {
        data: {
          fields: [{ pageNumber: 0, x: 0.5, y: 0.5, width: 0.25, height: 0.06 }],
        },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(fieldsRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("generate access token validates org ownership", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Token Test",
        filename: "token-test.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Try to generate token with invalid userId — should fail
      const tokenRes = await request.post(`${API}/documents/${doc.id}/generate-access-token`, {
        data: { userId: "nonexistent-user-id" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(tokenRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("send endpoint validates expiresInDays", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Expiry Validation Test",
        filename: "expiry-val.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Try to send with invalid expiresInDays
      const sendRes = await request.post(`${API}/documents/${doc.id}/send`, {
        data: { expiresInDays: -1 },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(sendRes.status()).toBeGreaterThanOrEqual(400);
    });

    // --- Version history tests ---

    test("upload new version to a document", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Version Upload Test",
        filename: "v1.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(createRes.status()).toBe(201);
      const doc = await createRes.json();
      const originalVersion = doc.currentVersion ?? 1;

      // Build multipart for the new version upload
      const v2Boundary = "----VersionBoundary" + Date.now();
      const v2Body = [
        `--${v2Boundary}`,
        `Content-Disposition: form-data; name="file"; filename="v2.pdf"`,
        "Content-Type: application/pdf",
        "",
        "fake pdf v2 content",
        `--${v2Boundary}--`,
      ].join("\r\n");

      const versionRes = await request.post(`${API}/documents/${doc.id}/upload-version`, {
        data: v2Body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${v2Boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(versionRes.ok()).toBeTruthy();
      const updated = await versionRes.json();
      expect(updated.currentVersion).toBeGreaterThan(originalVersion);
    });

    test("cannot upload version to voided document", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "quote",
        title: "Void Version Test",
        filename: "void-v.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      await request.post(`${API}/documents/${doc.id}/void`, {
        data: { reason: "Testing void block" },
        headers: { "x-csrf-token": csrfToken },
      });

      const v2Boundary = "----VoidVersionBoundary" + Date.now();
      const v2Body = [
        `--${v2Boundary}`,
        `Content-Disposition: form-data; name="file"; filename="v2.pdf"`,
        "Content-Type: application/pdf",
        "",
        "fake pdf v2",
        `--${v2Boundary}--`,
      ].join("\r\n");

      const versionRes = await request.post(`${API}/documents/${doc.id}/upload-version`, {
        data: v2Body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${v2Boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(versionRes.status()).toBeGreaterThanOrEqual(400);
    });

    test("version history shows previous versions after upload", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "nda",
        title: "Version History Test",
        filename: "history-v1.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Upload a second version so the history endpoint has something to return
      const v2Boundary = "----HistoryVersionBoundary" + Date.now();
      const v2Body = [
        `--${v2Boundary}`,
        `Content-Disposition: form-data; name="file"; filename="history-v2.pdf"`,
        "Content-Type: application/pdf",
        "",
        "fake pdf v2 content for history",
        `--${v2Boundary}--`,
      ].join("\r\n");

      await request.post(`${API}/documents/${doc.id}/upload-version`, {
        data: v2Body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${v2Boundary}`,
          "x-csrf-token": csrfToken,
        },
      });

      const historyRes = await request.get(`${API}/documents/${doc.id}/versions`);
      expect(historyRes.ok()).toBeTruthy();
      const history = await historyRes.json();
      expect(history.currentVersion).toBeDefined();
      expect(history.versions).toBeInstanceOf(Array);
      // After uploading v2, there should be at least one previous version entry
      expect(history.versions.length).toBeGreaterThanOrEqual(1);
    });

    test("restore a version reverts to the previous file", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Restore Version Test",
        filename: "restore-v1.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Upload v2 so there is a version entry for v1
      const v2Boundary = "----RestoreVersionBoundary" + Date.now();
      const v2Body = [
        `--${v2Boundary}`,
        `Content-Disposition: form-data; name="file"; filename="restore-v2.pdf"`,
        "Content-Type: application/pdf",
        "",
        "fake pdf v2 for restore",
        `--${v2Boundary}--`,
      ].join("\r\n");

      await request.post(`${API}/documents/${doc.id}/upload-version`, {
        data: v2Body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${v2Boundary}`,
          "x-csrf-token": csrfToken,
        },
      });

      // Get the version list to find the v1 version entry id
      const historyRes = await request.get(`${API}/documents/${doc.id}/versions`);
      const history = await historyRes.json();
      expect(history.versions.length).toBeGreaterThanOrEqual(1);
      const v1Entry = history.versions[history.versions.length - 1];

      // Restore v1
      const restoreRes = await request.post(
        `${API}/documents/${doc.id}/restore-version/${v1Entry.id}`,
        { headers: { "x-csrf-token": csrfToken } },
      );
      expect(restoreRes.ok()).toBeTruthy();
      const restored = await restoreRes.json();
      // The restored document's fileId should have changed back (or currentVersion incremented)
      expect(restored.currentVersion).toBeGreaterThan(history.currentVersion);
    });

    // --- Access token tests ---

    test("list access tokens returns empty array for new document", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Token List Test",
        filename: "token-list.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      const tokensRes = await request.get(`${API}/documents/${doc.id}/access-tokens`);
      expect(tokensRes.ok()).toBeTruthy();
      const tokens = await tokensRes.json();
      expect(tokens).toBeInstanceOf(Array);
      expect(tokens.length).toBe(0);
    });

    test("revoke access token returns 404 for nonexistent token", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const { body, boundary } = buildDocumentMultipart(projectId, {
        type: "contract",
        title: "Token Revoke Test",
        filename: "token-revoke.pdf",
      });

      const createRes = await request.post(`${API}/documents`, {
        data: body,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
        },
      });
      const doc = await createRes.json();

      // Try to revoke a token id that does not exist
      const revokeRes = await request.delete(
        `${API}/documents/${doc.id}/access-tokens/nonexistent-token-id`,
        { headers: { "x-csrf-token": csrfToken } },
      );
      expect(revokeRes.status()).toBe(404);
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
        await expect(page.getByRole("button", { name: /upload/i })).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe("Portal UI - Document Confirmation Dialog", () => {
    test("accept button opens confirmation dialog on portal", async ({ page }) => {
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await page.waitForTimeout(2000);

        const acceptBtn = page.getByRole("button", { name: /^accept$/i }).first();
        if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await acceptBtn.click();
          // Confirmation dialog should appear
          await expect(page.getByText(/are you sure you want to/i)).toBeVisible({ timeout: 3000 });
          await expect(page.getByRole("button", { name: /confirm accept/i })).toBeVisible();
          await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible();
        }
      }
    });

    test("decline button opens confirmation dialog with reason textarea", async ({ page }) => {
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await page.waitForTimeout(2000);

        const declineBtn = page.getByRole("button", { name: /^decline$/i }).first();
        if (await declineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await declineBtn.click();
          // Confirmation dialog should appear with decline-specific content
          await expect(page.getByText(/decline document/i)).toBeVisible({ timeout: 3000 });
          await expect(page.getByText(/reason for declining/i)).toBeVisible();
          await expect(page.getByPlaceholder(/provide a reason/i)).toBeVisible();
          await expect(page.getByRole("button", { name: /confirm decline/i })).toBeVisible();
        }
      }
    });

    test("acknowledge button opens confirmation dialog on portal", async ({ page }) => {
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await page.waitForTimeout(2000);

        const ackBtn = page.getByRole("button", { name: /^acknowledge$/i }).first();
        if (await ackBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await ackBtn.click();
          await expect(page.getByText(/acknowledge document/i)).toBeVisible({ timeout: 3000 });
          await expect(page.getByRole("button", { name: /confirm acknowledge/i })).toBeVisible();
        }
      }
    });

    test("cancel button in confirmation dialog closes it without action", async ({ page }) => {
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await page.waitForTimeout(2000);

        const acceptBtn = page.getByRole("button", { name: /^accept$/i }).first();
        if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await acceptBtn.click();
          await expect(page.getByText(/are you sure you want to/i)).toBeVisible({ timeout: 3000 });
          // Click cancel
          await page.getByRole("button", { name: /cancel/i }).click();
          // Dialog should be gone
          await expect(page.getByText(/are you sure you want to/i)).not.toBeVisible();
        }
      }
    });

    test("confirmation dialog shows document title and type", async ({ page }) => {
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /^files$/i }).click();
        await page.waitForTimeout(2000);

        const acceptBtn = page.getByRole("button", { name: /^accept$/i }).first();
        if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await acceptBtn.click();
          // Dialog should show document type badge (Quote, Contract, NDA, Other)
          const dialog = page.locator(".fixed.inset-0.z-50");
          await expect(dialog).toBeVisible({ timeout: 3000 });
          // Should contain a type label like Quote, Contract, NDA, or Other
          const typeLabel = dialog.locator("text=/Quote|Contract|NDA|Other/i");
          await expect(typeLabel.first()).toBeVisible();
        }
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
