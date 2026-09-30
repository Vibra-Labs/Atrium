import { ForbiddenException, HttpException, Logger } from "@nestjs/common";
import * as z from "zod/v4";
import type { Actor } from "../common";

const logger = new Logger("McpTools");

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  ownerOnly: boolean;
  handler: (input: unknown, actor: Actor) => Promise<unknown>;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * Declares a tool with a typed handler. The returned value is type-erased so
 * tools with different schemas can live in one array; the MCP SDK has already
 * validated the input against `inputSchema` before the handler runs.
 */
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  inputSchema: S;
  ownerOnly?: boolean;
  handler: (input: z.infer<S>, actor: Actor) => Promise<unknown>;
}): McpTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    ownerOnly: def.ownerOnly ?? false,
    handler: (input: unknown, actor: Actor): Promise<unknown> =>
      def.handler(input as z.infer<S>, actor),
  };
}

export function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value ?? { ok: true }) }] };
}

export function fail(err: unknown): ToolResult {
  let text: string = "Internal error";
  if (err instanceof HttpException) {
    const response: string | object = err.getResponse();
    const message: unknown =
      typeof response === "string" ? response : (response as { message?: unknown }).message;
    text = Array.isArray(message) ? message.join("; ") : String(message ?? err.message);
  } else {
    logger.error("Unhandled tool error", err instanceof Error ? err.stack : String(err));
  }
  return { isError: true, content: [{ type: "text", text }] };
}

export async function runTool(tool: McpTool, input: unknown, actor: Actor): Promise<ToolResult> {
  try {
    if (tool.ownerOnly && actor.member.role !== "owner") {
      throw new ForbiddenException("Only the workspace owner can do this.");
    }
    return ok(await tool.handler(input, actor));
  } catch (err) {
    return fail(err);
  }
}

/** Spread into list-tool schemas. Matches the services' page/limit pagination. */
export const paging = {
  page: z.number().int().min(1).default(1).describe("Page number, starting at 1"),
  limit: z.number().int().min(1).max(50).default(20).describe("Results per page (max 50)"),
};

/** Shared ISO 8601 date input. Keeps prose like "next friday" out of `new Date()`. */
export const isoDate = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .describe("ISO 8601 date, e.g. 2026-10-01");
