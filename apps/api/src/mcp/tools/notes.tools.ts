import * as z from "zod/v4";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { NotesService } from "../../notes/notes.service";

export function noteTools(deps: { notes: NotesService }): McpTool[] {
  const { notes } = deps;
  return [
    defineTool({
      name: "list_notes",
      description: "Lists a project's internal notes. Notes are visible to the team only, never to clients.",
      inputSchema: z.object({ projectId: z.string(), ...paging }),
      handler: async (input, actor) =>
        notes.findByProject(input.projectId, actor.organization.id, input.page, input.limit),
    }),
    defineTool({
      name: "add_note",
      description: "Adds an internal note to a project. Clients never see notes.",
      inputSchema: z.object({
        projectId: z.string(),
        content: z.string().min(1).max(5000),
      }),
      handler: async (input, actor) =>
        notes.create(input.content, input.projectId, actor.organization.id, actor.user.id),
    }),
    defineTool({
      name: "delete_note",
      description: "Permanently deletes an internal note.",
      inputSchema: z.object({ noteId: z.string() }),
      handler: async (input, actor) => notes.remove(input.noteId, actor.organization.id),
    }),
  ];
}
