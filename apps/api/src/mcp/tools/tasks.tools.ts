import * as z from "zod/v4";
import { defineTool, isoDate, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { TasksService } from "../../tasks/tasks.service";

export function taskTools(deps: { tasks: TasksService }): McpTool[] {
  const { tasks } = deps;
  return [
    defineTool({
      name: "list_tasks",
      description: "Lists a project's tasks. status 'active' means open or in progress.",
      inputSchema: z.object({
        projectId: z.string(),
        status: z.enum(["active", "all", "open", "in_progress", "done", "cancelled"]).default("active"),
        ...paging,
      }),
      handler: async (input, actor) =>
        tasks.findByProject(input.projectId, actor.organization.id, input.page, input.limit, input.status),
    }),
    defineTool({
      name: "create_task",
      description: "Adds a checkbox task to a project. Clients of the project can see it.",
      inputSchema: z.object({
        projectId: z.string(),
        title: z.string().trim().min(1).max(255),
        description: z.string().max(5000).optional(),
        dueDate: isoDate.optional(),
      }),
      handler: async (input, actor) => {
        const { projectId, ...dto } = input;
        return tasks.create(dto, projectId, actor.organization.id);
      },
    }),
    defineTool({
      name: "update_task",
      description:
        "Updates a task. Set status to 'done' to complete it. Pass null for dueDate or assigneeId to clear them.",
      inputSchema: z.object({
        taskId: z.string(),
        title: z.string().trim().min(1).max(255).optional(),
        description: z.string().max(5000).optional(),
        dueDate: isoDate.nullable().optional(),
        status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
        assigneeId: z.string().nullable().optional().describe("userId of a team member, or null to unassign"),
      }),
      handler: async (input, actor) => {
        const { taskId, ...dto } = input;
        return tasks.update(taskId, dto, actor.organization.id);
      },
    }),
    defineTool({
      name: "delete_task",
      description: "Permanently deletes a task.",
      inputSchema: z.object({ taskId: z.string() }),
      handler: async (input, actor) => tasks.remove(input.taskId, actor.organization.id),
    }),
  ];
}
