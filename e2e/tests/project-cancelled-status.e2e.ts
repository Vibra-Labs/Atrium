import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Cancelled project status", () => {
  test("workspace has a Cancelled status and a project can be set to it", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();
    const headers = { "x-csrf-token": csrfToken, "Content-Type": "application/json" };

    const statusesRes = await request.get(`${API}/projects/statuses`);
    expect(statusesRes.ok()).toBeTruthy();
    const statuses: { slug: string; name: string }[] = await statusesRes.json();
    expect(statuses.map((s) => s.slug)).toContain("cancelled");

    const createRes = await request.post(`${API}/projects`, {
      data: { name: `Cancelled ${Date.now()}` },
      headers,
    });
    expect(createRes.ok()).toBeTruthy();
    const project = await createRes.json();

    const updateRes = await request.put(`${API}/projects/${project.id}`, {
      data: { status: "cancelled" },
      headers,
    });
    expect(updateRes.ok()).toBeTruthy();
    expect((await updateRes.json()).status).toBe("cancelled");

    // Hidden from the default list, like archived projects
    const listIds = async (query: string): Promise<string[]> => {
      const res = await request.get(`${API}/projects?search=${encodeURIComponent(project.name)}${query}`);
      expect(res.ok()).toBeTruthy();
      return ((await res.json()).data as { id: string }[]).map((p) => p.id);
    };
    expect(await listIds("")).not.toContain(project.id);
    expect(await listIds("&archived=true")).toContain(project.id);
    expect(await listIds("&status=cancelled")).toContain(project.id);
  });
});
