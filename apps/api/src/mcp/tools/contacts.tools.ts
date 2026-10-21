import * as z from "zod/v4";
import { CONTACT_RATINGS, CONTACT_STATUSES } from "@atrium/shared";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ContactsService } from "../../contacts/contacts.service";

export function contactTools(deps: { contacts: ContactsService }): McpTool[] {
  const { contacts } = deps;
  return [
    defineTool({
      name: "list_contacts",
      description:
        "Lists CRM contacts (leads, clients, past clients) with name parts, job title, department, phones, social links and rating; optionally filtered by search text, status or rating.",
      inputSchema: z.object({
        search: z.string().max(200).optional(),
        status: z.enum(CONTACT_STATUSES).optional(),
        rating: z.enum(CONTACT_RATINGS).optional(),
        ...paging,
      }),
      handler: async (input, actor) => contacts.findAll(actor.organization.id, input),
    }),
    defineTool({
      name: "get_contact",
      description:
        "Gets one CRM contact: first/last name, job title, department, email, phones, social links, rating, company, lead source, labels and follow-up.",
      inputSchema: z.object({ contactId: z.string() }),
      handler: async (input, actor) => contacts.findOne(input.contactId, actor.organization.id),
    }),
    defineTool({
      name: "add_contact_note",
      description: "Adds an internal note to a CRM contact. Contacts and their notes are never visible to clients.",
      inputSchema: z.object({
        contactId: z.string(),
        content: z.string().trim().min(1).max(5000),
      }),
      handler: async (input, actor) =>
        contacts.addNote(input.contactId, input.content, actor.organization.id, actor.user.id),
    }),
  ];
}
