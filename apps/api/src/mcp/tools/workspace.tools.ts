import * as z from "zod/v4";
import { defineTool } from "../tool-kit";
import type { McpTool } from "../tool-kit";

export function workspaceTools(): McpTool[] {
  return [
    defineTool({
      name: "get_workspace",
      description:
        "Returns the Atrium workspace this connection is bound to and the user you are acting as. Call this first to orient yourself.",
      inputSchema: z.object({}),
      handler: async (_input, actor) => ({
        workspace: {
          id: actor.organization.id,
          name: actor.organization.name,
          slug: actor.organization.slug,
        },
        actingAs: {
          id: actor.user.id,
          name: actor.user.name,
          email: actor.user.email,
          role: actor.member.role,
        },
      }),
    }),
  ];
}
