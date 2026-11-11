import { BadRequestException } from "@nestjs/common";
import * as z from "zod/v4";
import { defineTool, isoDate, paging } from "../tool-kit";
import type { McpTool } from "../tool-kit";
import type { ProjectsService } from "../../projects/projects.service";
import type { BillingService } from "../../billing/billing.service";
import type { PursuitService } from "../../projects/pursuit.service";
import type { PursuitStagesService } from "../../projects/pursuit-stages.service";
import { MAX_CENTS } from "@atrium/shared";

const projectFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).optional(),
  status: z.string().max(100).optional().describe("A status slug from list_project_statuses"),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  clientUserIds: z.array(z.string()).optional().describe("User IDs from list_clients to give portal access"),
};

const nullableDate = isoDate.nullable().optional();

/**
 * The tool description tells agents to take a slug from
 * `list_project_statuses`, but `Project.status` is a plain string column, so
 * anything at all used to be stored — leaving a project in a status the
 * workspace's board does not show.
 */
async function assertKnownStatus(
  projects: ProjectsService,
  organizationId: string,
  status: string | undefined,
): Promise<void> {
  if (status === undefined) return;
  const statuses = await projects.getStatuses(organizationId);
  const slugs: string[] = statuses.map((s) => s.slug);
  if (!slugs.includes(status)) {
    throw new BadRequestException(
      `Unknown status "${status}". Valid statuses: ${slugs.join(", ")}`,
    );
  }
}

/** Only meaningful when the same call supplies both ends of the range. */
function assertDateOrder(startDate: string | undefined, endDate: string | undefined): void {
  if (startDate === undefined || endDate === undefined) return;
  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    throw new BadRequestException("endDate must not be before startDate");
  }
}

export function projectTools(deps: {
  projects: ProjectsService;
  billing: BillingService;
  pursuits: PursuitService;
  stages: PursuitStagesService;
}): McpTool[] {
  const { projects, billing, pursuits, stages } = deps;
  return [
    defineTool({
      name: "list_projects",
      description:
        "Lists projects in the workspace, newest first. Archived projects are hidden unless archived is true.",
      inputSchema: z.object({
        search: z.string().max(200).optional().describe("Matches project names"),
        status: z.string().max(100).optional().describe("A status slug from list_project_statuses"),
        archived: z.boolean().default(false),
        pursuit: z
          .enum(["only", "exclude"])
          .optional()
          .describe("only: open potential contracts (unsigned work). exclude: signed work only."),
        ...paging,
      }),
      handler: async (input, actor) =>
        projects.findAll(actor.organization.id, {
          page: input.page,
          limit: input.limit,
          search: input.search,
          status: input.status,
          archived: input.archived ? "true" : undefined,
          pursuit: input.pursuit,
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
      description:
        "Creates a project. Only name is required. Set potential to create a potential contract: work that isn't signed yet, with no portal access until it's won.",
      inputSchema: z.object({
        ...projectFields,
        potential: z.boolean().optional().describe("Create as a potential contract (not signed yet)"),
      }),
      handler: async (input, actor) => {
        assertDateOrder(input.startDate, input.endDate);
        await assertKnownStatus(projects, actor.organization.id, input.status);
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
        assertDateOrder(input.startDate, input.endDate);
        await assertKnownStatus(projects, actor.organization.id, input.status);
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
      name: "list_pipeline_stages",
      description:
        "Lists the workspace's potential-contract pipelines, first (the default for new contracts) first, each with its stages in order. Use a pipeline's id and a stage's slug with update_potential_contract.",
      inputSchema: z.object({}),
      handler: async (_input, actor) => stages.findAll(actor.organization.id),
    }),
    defineTool({
      name: "update_potential_contract",
      description:
        "Updates deal fields on an open potential contract. Only the fields you pass change; null clears one. Values are in cents.",
      inputSchema: z.object({
        projectId: z.string(),
        pipelineId: z
          .string()
          .max(64)
          .optional()
          .describe("Move it to another pipeline (id from list_pipeline_stages); keeps the stage if that pipeline has it"),
        stage: z.string().max(64).optional().describe("A stage slug from list_pipeline_stages, in the contract's pipeline"),
        valueCents: z.number().int().min(0).max(MAX_CENTS).nullable().optional(),
        closeDate: nullableDate.describe("Expected close, or bid due when isBid"),
        nextStep: z.string().max(500).nullable().optional(),
        nextStepAt: nullableDate,
        isBid: z.boolean().optional().describe("A formal bid (RFP/RFQ): shows the solicitation fields"),
        solicitationNumber: z.string().max(100).nullable().optional(),
        questionsDueAt: nullableDate,
        sourceUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
        companyId: z.string().nullable().optional(),
      }),
      handler: async (input, actor) => {
        const { projectId, ...patch } = input;
        return pursuits.update(projectId, patch, actor.organization.id);
      },
    }),
    defineTool({
      name: "mark_potential_contract_won",
      description:
        "Marks a potential contract won: it becomes active work, the contact (if given) becomes a client, and everything made so far stays internal. Portal access is only given when giveAccess is true.",
      inputSchema: z.object({
        projectId: z.string(),
        contactId: z.string().optional().describe("The client, from list_contacts. Optional; needed for giveAccess"),
        status: z.string().max(100).describe("A status slug from list_project_statuses (not cancelled or completed)"),
        giveAccess: z.boolean().default(false),
      }),
      handler: async (input, actor) => {
        const { projectId, ...dto } = input;
        const result = await pursuits.win(projectId, dto, actor.organization.id);
        if (result.accessFailed) {
          return { ...result, note: "Won, but linking the contact or giving them access failed. Add them to the project by hand." };
        }
        if (!result.inviteEmail) return result;
        return {
          ...result,
          note: `${result.inviteEmail} has no portal login yet. Send them a portal invite from Contacts; accepting it gives them this project.`,
        };
      },
    }),
    defineTool({
      name: "mark_potential_contract_lost",
      description: "Marks a potential contract lost and archives it. reopen_potential_contract brings it back.",
      inputSchema: z.object({ projectId: z.string(), reason: z.string().max(500).optional() }),
      handler: async (input, actor) =>
        pursuits.lose(input.projectId, { reason: input.reason }, actor.organization.id),
    }),
    defineTool({
      name: "reopen_potential_contract",
      description: "Reopens a lost potential contract at the Lead stage.",
      inputSchema: z.object({ projectId: z.string() }),
      handler: async (input, actor) => pursuits.reopen(input.projectId, actor.organization.id),
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
