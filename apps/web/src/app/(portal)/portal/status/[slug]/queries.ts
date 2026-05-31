import { cookies } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeJson } from "@/lib/safe-fetch";

type SessionLike = { user?: { id?: string } } | null;
type NavigationFns = {
  redirect: (path: string) => never;
  notFound: () => never;
  forbidden: () => never;
};
type StatusApiClient = {
  getStatusPageProject: (slug: string) => Promise<Response>;
};

export type StatusPageProject = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  organizationId: string;
  organization: { id: string; name: string; slug: string | null };
  clients: Array<{ id: string; user: { id: string; name: string; email: string } }>;
  updates: Array<{
    id: string;
    title: string | null;
    content: string;
    createdAt: Date;
  }>;
  comments: StatusComment[];
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    completedAt: Date | null;
    comments: StatusComment[];
    deliverables: Array<{
      id: string;
      title: string;
      type: string;
      url: string | null;
      file: { filename: string; url: string | null } | null;
    }>;
  }>;
};

export type StatusComment = {
  id: string;
  content: string;
  authorId: string;
  createdAt: Date;
};

const API_URL = process.env.API_URL || "http://localhost:3001";

function statusSignInPath(slug: string): string {
  return `/portal/sign-in?callbackUrl=${encodeURIComponent(`/portal/status/${slug}`)}`;
}

async function getStatusPageProjectFromApi(slug: string): Promise<Response> {
  const cookieStore = await cookies();
  return fetch(`${API_URL}/api/projects/status/${encodeURIComponent(slug)}`, {
    headers: { Cookie: cookieStore.toString() },
    cache: "no-store",
    redirect: "manual",
  });
}

export async function resolveStatusPageAccessWithDeps(
  slug: string,
  deps: {
    getSession: () => Promise<SessionLike>;
    apiClient: StatusApiClient;
    navigation: NavigationFns;
  },
) {
  const session = await deps.getSession();
  const userId = session?.user?.id;

  if (!userId) {
    deps.navigation.redirect(statusSignInPath(slug));
  }

  const res = await deps.apiClient.getStatusPageProject(slug);

  if (res.status === 401 || res.status === 302 || res.status === 307 || res.status === 308) {
    deps.navigation.redirect(statusSignInPath(slug));
  }

  if (res.status === 404) {
    deps.navigation.notFound();
  }

  if (res.status === 403) {
    deps.navigation.forbidden();
  }

  if (!res.ok) {
    throw new Error(`Status page API request failed: ${res.status}`);
  }

  const project = await safeJson<StatusPageProject>(res);
  if (!project) {
    throw new Error("Status page API returned an empty project response");
  }

  return { session, project };
}

export async function resolveStatusPageAccess(slug: string) {
  return resolveStatusPageAccessWithDeps(slug, {
    getSession,
    apiClient: { getStatusPageProject: getStatusPageProjectFromApi },
    navigation: { redirect, notFound, forbidden },
  });
}

export async function loadStatusPageProject(slug: string): Promise<StatusPageProject> {
  const { project } = await resolveStatusPageAccess(slug);
  return project;
}

export function getProjectStats(project: Pick<StatusPageProject, "tasks">) {
  const tasksTotal = project.tasks.length;
  const completedTasks = project.tasks.filter((task) => task.completedAt || task.status === "done").length;
  const completionPercent = tasksTotal === 0 ? 0 : Math.round((completedTasks / tasksTotal) * 100);
  const deliverablesCount = project.tasks.reduce((sum, task) => sum + task.deliverables.length, 0);

  return {
    tasksTotal,
    completedTasks,
    completionPercent,
    deliverablesCount,
  };
}
