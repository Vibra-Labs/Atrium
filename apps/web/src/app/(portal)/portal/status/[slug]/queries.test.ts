import { describe, expect, test } from "bun:test";
import { resolveStatusPageAccessWithDeps } from "./queries";

function nav() {
  return {
    redirect: (path: string): never => {
      throw Object.assign(new Error("redirect"), { kind: "redirect", path });
    },
    notFound: (): never => {
      throw Object.assign(new Error("not-found"), { kind: "not-found" });
    },
    forbidden: (): never => {
      throw Object.assign(new Error("forbidden"), { kind: "forbidden" });
    },
  };
}

function response(status: number, body?: unknown) {
  return Promise.resolve(
    new Response(body === undefined ? undefined : JSON.stringify(body), {
      status,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
    }),
  );
}

const project = {
  id: "project-1",
  name: "CSP IT Onboarding",
  description: "Client-facing project status",
  status: "in_progress",
  createdAt: "2026-05-01T00:00:00.000Z",
  completedAt: null,
  organizationId: "org-1",
  organization: { id: "org-1", name: "CSP", slug: "csp" },
  clients: [{ id: "pc-1", user: { id: "client-1", name: "Client", email: "client@example.com" } }],
  updates: [],
  comments: [],
  tasks: [],
};

describe("client portal status access", () => {
  test("redirects unauthenticated requests to client sign-in", async () => {
    let apiCalls = 0;
    const deps = {
      getSession: async () => null,
      apiClient: { getStatusPageProject: async () => { apiCalls += 1; return response(200, project); } },
      navigation: nav(),
    };

    await expect(resolveStatusPageAccessWithDeps("csp-it-onboarding-may-2026", deps)).rejects.toMatchObject({
      kind: "redirect",
      path: "/portal/sign-in?callbackUrl=%2Fportal%2Fstatus%2Fcsp-it-onboarding-may-2026",
    });
    expect(apiCalls).toBe(0);
  });

  test("returns 404 if slug does not exist", async () => {
    const deps = {
      getSession: async () => ({ user: { id: "user-1" } }),
      apiClient: { getStatusPageProject: async () => response(404, { message: "Project not found" }) },
      navigation: nav(),
    };

    await expect(resolveStatusPageAccessWithDeps("missing", deps)).rejects.toMatchObject({ kind: "not-found" });
  });

  test("returns 403 if user is not a member of the project organization", async () => {
    const deps = {
      getSession: async () => ({ user: { id: "user-1" } }),
      apiClient: { getStatusPageProject: async () => response(403, { message: "Project access forbidden" }) },
      navigation: nav(),
    };

    await expect(resolveStatusPageAccessWithDeps("existing", deps)).rejects.toMatchObject({ kind: "forbidden" });
  });

  test("returns the API project for authenticated member-visible requests", async () => {
    const deps = {
      getSession: async () => ({ user: { id: "user-1" } }),
      apiClient: { getStatusPageProject: async () => response(200, project) },
      navigation: nav(),
    };

    const result = await resolveStatusPageAccessWithDeps("existing", deps);
    expect(result.session?.user?.id).toBe("user-1");
    expect(result.project).toEqual(project);
  });
});
