import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { TasksModule } from "../tasks/tasks.module";
import { UpdatesModule } from "../updates/updates.module";
import { NotesModule } from "../notes/notes.module";
import { ClientsModule } from "../clients/clients.module";
import { BillingModule } from "../billing/billing.module";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

@Module({
  imports: [ProjectsModule, TasksModule, UpdatesModule, NotesModule, ClientsModule, BillingModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
