import * as z from "zod/v4";
import { defineTool } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { DocumentsService } from "../../documents/documents.service";

export function documentTools(deps: { documents: Pick<DocumentsService, "findPendingApprovals"> }): McpTool[] {
  const { documents } = deps;
  return [
    defineTool({
      name: "list_pending_approvals",
      description:
        "Lists deliverables and documents waiting on a client decision, plus ones where the client requested changes (listed first). Read-only.",
      inputSchema: z.object({ projectId: z.string().optional() }),
      handler: async (input, actor) => documents.findPendingApprovals(actor.organization.id, input.projectId),
    }),
  ];
}
