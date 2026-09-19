import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { UpdatesService } from "../../updates/updates.service";

export function updateTools(deps: { updates: UpdatesService }): McpTool[] {
  const { updates } = deps;
  return [
    defineTool({
      name: "list_updates",
      description: "Lists the progress updates posted on a project, newest first.",
      inputSchema: z.object({ projectId: z.string(), ...paging }),
      handler: async (input, actor) =>
        updates.findByProject(input.projectId, actor.organization.id, input.page, input.limit),
    }),
    defineTool({
      name: "post_update",
      description:
        "Posts a progress update to a project. The project's clients see it in their portal and may be notified by email, so confirm the wording with the user first.",
      inputSchema: z.object({
        projectId: z.string(),
        content: z.string().min(1).max(5000),
      }),
      handler: async (input, actor) =>
        updates.create(
          { content: input.content },
          input.projectId,
          actor.organization.id,
          actor.user.id,
          actor.member.role,
        ),
    }),
  ];
}
