import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ClientsService } from "../../clients/clients.service";
import type { ProjectsService } from "../../projects/projects.service";

export function clientTools(deps: {
  clients: ClientsService;
  projects: ProjectsService;
}): McpTool[] {
  const { clients, projects } = deps;
  return [
    defineTool({
      name: "list_clients",
      description:
        "Lists everyone in the workspace: team (role owner or admin) and clients (role member). Each entry has a userId used by other tools.",
      inputSchema: z.object({
        search: z.string().max(200).optional().describe("Matches name or email"),
        ...paging,
      }),
      handler: async (input, actor) =>
        clients.list(actor.organization.id, input.page, input.limit, input.search),
    }),
    defineTool({
      name: "get_client",
      description: "Returns one person's membership, company profile, and the projects they can see.",
      inputSchema: z.object({ clientUserId: z.string().describe("userId from list_clients") }),
      handler: async (input, actor) => {
        const orgId: string = actor.organization.id;
        const member = await clients.findMember(input.clientUserId, orgId);
        const [profile, clientProjects] = await Promise.all([
          clients.getProfile(input.clientUserId, orgId),
          projects.findByClient(input.clientUserId, orgId, { page: 1, limit: 50 }),
        ]);
        return { member, profile, projects: clientProjects.data };
      },
    }),
  ];
}
