import * as z from "zod/v4";
import { CONTACT_RATINGS, CONTACT_STATUSES } from "@atrium/shared";
import { defineTool, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ContactsService } from "../../contacts/contacts.service";
import { PORTAL_ACCESS_FILTERS } from "../../contacts/contacts.dto";

export function contactTools(deps: { contacts: ContactsService }): McpTool[] {
  const { contacts } = deps;
  return [
    defineTool({
      name: "list_contacts",
      description:
        "Lists CRM contacts (leads, clients, past clients) with name parts, job title, department, phones, social links, rating and portal access (portalAccess: portal = has a client portal login, pending = invited, null = neither); optionally filtered by search text, status, rating or portal access.",
      inputSchema: z.object({
        search: z.string().max(200).optional(),
        status: z.enum(CONTACT_STATUSES).optional(),
        rating: z.enum(CONTACT_RATINGS).optional(),
        access: z.enum(PORTAL_ACCESS_FILTERS).optional().describe("portal, pending (invited) or none"),
        ...paging,
      }),
      handler: async (input, actor) => contacts.findAll(actor.organization.id, input),
    }),
    defineTool({
      name: "get_contact",
      description:
        "Gets one CRM contact: first/last name, job title, department, email, phones, social links, rating, about (description), company, lead source, labels, follow-up and portal access (portal: { memberId, joinedAt, lastSeenAt } or null).",
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
