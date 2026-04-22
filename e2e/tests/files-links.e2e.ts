import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("File links", () => {
  test("creates a link file, lists it, and blocks download", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();

    // 1. Find a project to attach the link to
    const projectsRes = await request.get(`${API}/projects?limit=1`);
    expect(projectsRes.ok()).toBeTruthy();
    const projects = await projectsRes.json();
    if (!projects.data?.length) return;
    const projectId = projects.data[0].id as string;

    // 2. POST /files/link creates a LINK-type file
    const linkRes = await request.post(`${API}/files/link`, {
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      data: {
        projectId,
        url: "https://cloud.example.com/s/abc123",
        title: "Shared Nextcloud Folder",
        description: "Design assets and references",
      },
    });
    expect(linkRes.ok()).toBeTruthy();
    const link = await linkRes.json();
    expect(link.type).toBe("LINK");
    expect(link.url).toBe("https://cloud.example.com/s/abc123");
    expect(link.filename).toBe("Shared Nextcloud Folder");
    expect(link.description).toBe("Design assets and references");
    expect(link.storageKey).toBeNull();

    // 3. List endpoint returns the link
    const listRes = await request.get(`${API}/files/project/${projectId}`);
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    const found = (list.data ?? list).find(
      (f: { id: string }) => f.id === link.id,
    );
    expect(found).toBeTruthy();
    expect(found.type).toBe("LINK");

    // 4. Download endpoint rejects LINK type
    const downloadRes = await request.get(`${API}/files/${link.id}/download`);
    expect(downloadRes.status()).toBe(400);

    // 5. URL endpoint rejects LINK type
    const urlRes = await request.get(`${API}/files/${link.id}/url`);
    expect(urlRes.status()).toBe(400);

    // 6. Delete endpoint works for LINK type
    const deleteRes = await request.delete(`${API}/files/${link.id}`, {
      headers: { "x-csrf-token": csrfToken },
    });
    expect(deleteRes.ok()).toBeTruthy();
  });

  test("rejects non-http(s) URLs", async ({ request }) => {
    const csrfToken = getCsrfToken();

    const projectsRes = await request.get(`${API}/projects?limit=1`);
    const projects = await projectsRes.json();
    if (!projects.data?.length) return;
    const projectId = projects.data[0].id as string;

    const ftpRes = await request.post(`${API}/files/link`, {
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      data: {
        projectId,
        url: "ftp://example.com/file.txt",
        title: "Bad link",
      },
    });
    expect(ftpRes.status()).toBe(400);

    const javascriptRes = await request.post(`${API}/files/link`, {
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      data: {
        projectId,
        // eslint-disable-next-line no-script-url
        url: "javascript:alert(1)",
        title: "XSS attempt",
      },
    });
    expect(javascriptRes.status()).toBe(400);
  });

  test("rejects missing title", async ({ request }) => {
    const csrfToken = getCsrfToken();

    const projectsRes = await request.get(`${API}/projects?limit=1`);
    const projects = await projectsRes.json();
    if (!projects.data?.length) return;
    const projectId = projects.data[0].id as string;

    const res = await request.post(`${API}/files/link`, {
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      data: {
        projectId,
        url: "https://example.com",
      },
    });
    expect(res.status()).toBe(400);
  });
});
