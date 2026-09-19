import { Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { Actor, AuthenticatedRequest } from "../common";
import { ProjectsService } from "../projects/projects.service";
import { TasksService } from "../tasks/tasks.service";
import { UpdatesService } from "../updates/updates.service";
import { NotesService } from "../notes/notes.service";
import { ClientsService } from "../clients/clients.service";
import { BillingService } from "../billing/billing.service";
import { RateLimiter } from "./rate-limiter";
import { runTool } from "./tool-kit";
import type { McpTool, ToolResult } from "./tool-kit";
import { workspaceTools } from "./tools/workspace.tools";
import { projectTools } from "./tools/projects.tools";
import { clientTools } from "./tools/clients.tools";
import { taskTools } from "./tools/tasks.tools";
import { updateTools } from "./tools/updates.tools";
import { noteTools } from "./tools/notes.tools";

const MCP_ROLES: string[] = ["owner", "admin"];
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60_000;

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly limiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

  constructor(
    private projects: ProjectsService,
    private tasks: TasksService,
    private updates: UpdatesService,
    private notes: NotesService,
    private clients: ClientsService,
    private billing: BillingService,
  ) {}

  tools(): McpTool[] {
    return [
      ...workspaceTools(),
      ...projectTools({ projects: this.projects, billing: this.billing }),
      ...clientTools({ clients: this.clients, projects: this.projects }),
      ...taskTools({ tasks: this.tasks }),
      ...updateTools({ updates: this.updates }),
      ...noteTools({ notes: this.notes }),
    ];
  }

  /** One server per request; the actor is closed over so tools never read transport context. */
  buildServer(actor: Actor): McpServer {
    const server = new McpServer({ name: "atrium", version: "1.0.0" });
    for (const tool of this.tools()) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (input: unknown): Promise<CallToolResult> => {
          const result: ToolResult = await runTool(tool, input, actor);
          return { content: result.content, isError: result.isError };
        },
      );
    }
    return server;
  }

  async handle(req: Request, res: Response): Promise<void> {
    const { user, organization, member, apiKeyId } = req as Partial<AuthenticatedRequest>;

    if (!user || !organization || !member) {
      res
        .status(401)
        .set("WWW-Authenticate", "Bearer")
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    if (!MCP_ROLES.includes(member.role)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "MCP access requires the owner or admin role" },
        id: null,
      });
      return;
    }
    if (!this.limiter.allow(apiKeyId ?? user.id)) {
      res.status(429).set("Retry-After", "60").json({
        jsonrpc: "2.0",
        error: { code: -32029, message: "Rate limit exceeded. Retry in 60 seconds." },
        id: null,
      });
      return;
    }

    const server: McpServer = this.buildServer({ user, organization, member });
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close().catch((err: unknown) => this.logger.warn(`transport close failed: ${String(err)}`));
      server.close().catch((err: unknown) => this.logger.warn(`server close failed: ${String(err)}`));
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error("MCP request failed", err instanceof Error ? err.stack : String(err));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  }
}
