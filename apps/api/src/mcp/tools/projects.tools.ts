import * as z from "zod/v4";
import { defineTool, isoDate, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ProjectsService } from "../../projects/projects.service";
import type { BillingService } from "../../billing/billing.service";

const projectFields = {
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: z.string().max(100).optional().describe("A status slug from list_project_statuses"),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  clientUserIds: z.array(z.string()).optional().describe("User IDs from list_clients to give portal access"),
};

export function projectTools(deps: {
  projects: ProjectsService;
  billing: BillingService;
}): McpTool[] {
  const { projects, billing } = deps;
  return [
    defineTool({
      name: "list_projects",
      description:
        "Lists projects in the workspace, newest first. Archived projects are hidden unless archived is true.",
      inputSchema: z.object({
        search: z.string().max(200).optional().describe("Matches project names"),
        status: z.string().max(100).optional().describe("A status slug from list_project_statuses"),
        archived: z.boolean().default(false),
        ...paging,
      }),
      handler: async (input, actor) =>
        projects.findAll(actor.organization.id, {
          page: input.page,
          limit: input.limit,
          search: input.search,
          status: input.status,
          archived: input.archived ? "true" : undefined,
        }),
    }),
    defineTool({
      name: "get_project",
      description: "Returns one project with its clients and details.",
      inputSchema: z.object({ projectId: z.string() }),
      handler: async (input, actor) => projects.findOne(input.projectId, actor.organization.id),
    }),
    defineTool({
      name: "create_project",
      description: "Creates a project. Only name is required.",
      inputSchema: z.object(projectFields),
      handler: async (input, actor) => {
        await billing.assertPlanLimit(actor.organization.id, "projects");
        return projects.create(input, actor.organization.id);
      },
    }),
    defineTool({
      name: "update_project",
      description: "Updates fields on a project. Only the fields you pass are changed.",
      inputSchema: z.object({
        projectId: z.string(),
        ...projectFields,
        name: projectFields.name.optional(),
      }),
      handler: async (input, actor) => {
        const { projectId, ...patch } = input;
        return projects.update(projectId, patch, actor.organization.id);
      },
    }),
    defineTool({
      name: "archive_project",
      description: "Archives a project (archived: true) or restores it (archived: false). Nothing is deleted.",
      inputSchema: z.object({ projectId: z.string(), archived: z.boolean() }),
      handler: async (input, actor) =>
        input.archived
          ? projects.archive(input.projectId, actor.organization.id)
          : projects.unarchive(input.projectId, actor.organization.id),
    }),
    defineTool({
      name: "list_project_statuses",
      description: "Lists the workspace's project statuses. Use a status slug when creating or filtering projects.",
      inputSchema: z.object({}),
      handler: async (_input, actor) => projects.getStatuses(actor.organization.id),
    }),
    defineTool({
      name: "delete_project",
      description:
        "Permanently deletes a project and everything in it. Owner only. Prefer archive_project unless the user explicitly asks to delete.",
      inputSchema: z.object({ projectId: z.string() }),
      ownerOnly: true,
      handler: async (input, actor) => projects.remove(input.projectId, actor.organization.id),
    }),
  ];
}
