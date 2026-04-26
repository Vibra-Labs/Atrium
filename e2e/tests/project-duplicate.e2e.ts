import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

test.describe("Project duplication", () => {
  test("duplicates a project with tasks, resetting state", async ({
    request,
  }) => {
    const csrfToken = getCsrfToken();

    // 1. Create a source project
    const stamp = Date.now();
    const projectRes = await request.post(`${API}/projects`, {
      data: { name: `Dup Source ${stamp}`, description: "Template source" },
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });
    expect(projectRes.ok()).toBeTruthy();
    const source = await projectRes.json();

    // 2. Seed two tasks (one done, assigned; one decision)
    const t1 = await request.post(`${API}/tasks?projectId=${source.id}`, {
      data: {
        title: "Kickoff meeting",
        description: "Run the kickoff",
      },
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });
    expect(t1.ok()).toBeTruthy();
    const task1 = await t1.json();

    // Mark task1 done so we can verify status resets on duplicate
    const t1Update = await request.put(`${API}/tasks/${task1.id}`, {
      data: { status: "done" },
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });
    expect(t1Update.ok()).toBeTruthy();

    const t2 = await request.post(`${API}/tasks?projectId=${source.id}`, {
      data: {
        title: "Pick a direction",
        type: "decision",
        question: "Which way?",
        options: [{ label: "Left" }, { label: "Right" }],
      },
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });
    expect(t2.ok()).toBeTruthy();

    // 3. Duplicate
    const dupRes = await request.post(
      `${API}/projects/${source.id}/duplicate`,
      {
        data: { name: `Dup Source ${stamp} (copy)`, includeTasks: true },
        headers: {
          "x-csrf-token": csrfToken,
          "Content-Type": "application/json",
        },
      },
    );
    expect(dupRes.ok()).toBeTruthy();
    const dup = await dupRes.json();
    expect(dup.id).not.toBe(source.id);
    expect(dup.name).toBe(`Dup Source ${stamp} (copy)`);
    // Status should NOT be the source's status — schema default applies.
    expect(dup.status).toBe("not_started");

    // 4. New project has two tasks, both with reset state
    const listRes = await request.get(
      `${API}/tasks/project/${dup.id}?limit=50`,
    );
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    const tasks = (list.data ?? list) as Array<{
      title: string;
      status: string;
      dueDate: string | null;
      assigneeId: string | null;
      requestedById: string | null;
      type: string;
      question: string | null;
    }>;

    expect(tasks.length).toBe(2);
    for (const t of tasks) {
      expect(t.status).toBe("open");
      expect(t.dueDate).toBeNull();
      expect(t.assigneeId).toBeNull();
    }
    const titles = tasks.map((t) => t.title).sort();
    expect(titles).toEqual(["Kickoff meeting", "Pick a direction"]);

    // 5. Cleanup
    await request.delete(`${API}/projects/${dup.id}`, {
      headers: { "x-csrf-token": csrfToken },
    });
    await request.delete(`${API}/projects/${source.id}`, {
      headers: { "x-csrf-token": csrfToken },
    });
  });

  test("includeTasks=false skips tasks on duplicate", async ({ request }) => {
    const csrfToken = getCsrfToken();
    const stamp = Date.now();

    const projectRes = await request.post(`${API}/projects`, {
      data: { name: `Dup Empty ${stamp}` },
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });
    const source = await projectRes.json();

    await request.post(`${API}/tasks?projectId=${source.id}`, {
      data: { title: "Only task" },
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });

    const dupRes = await request.post(
      `${API}/projects/${source.id}/duplicate`,
      {
        data: { name: `Dup Empty ${stamp} (copy)`, includeTasks: false },
        headers: {
          "x-csrf-token": csrfToken,
          "Content-Type": "application/json",
        },
      },
    );
    expect(dupRes.ok()).toBeTruthy();
    const dup = await dupRes.json();

    const listRes = await request.get(
      `${API}/tasks/project/${dup.id}?limit=50`,
    );
    const list = await listRes.json();
    const tasks = list.data ?? list;
    expect(tasks.length).toBe(0);

    await request.delete(`${API}/projects/${dup.id}`, {
      headers: { "x-csrf-token": csrfToken },
    });
    await request.delete(`${API}/projects/${source.id}`, {
      headers: { "x-csrf-token": csrfToken },
    });
  });

  test("rejects duplicate when name is missing", async ({ request }) => {
    const csrfToken = getCsrfToken();
    const projectsRes = await request.get(`${API}/projects?limit=1`);
    const projects = await projectsRes.json();
    if (!projects.data?.length) return;
    const projectId = projects.data[0].id as string;

    const res = await request.post(`${API}/projects/${projectId}/duplicate`, {
      data: {},
      headers: { "x-csrf-token": csrfToken, "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });
});
