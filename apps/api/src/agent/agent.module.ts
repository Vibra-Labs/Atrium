import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TimeEntriesModule } from "../time-entries/time-entries.module";
import { AgentProjectsController } from "./agent-projects.controller";
import { AgentTasksController } from "./agent-tasks.controller";
import { AgentDeliverablesController } from "./agent-deliverables.controller";
import { AgentAuditController } from "./agent-audit.controller";
import { AgentCommentsController } from "./agent-comments.controller";
import { AgentProjectUpdatesController } from "./agent-project-updates.controller";
import { AgentProjectNotesController } from "./agent-project-notes.controller";
import { AgentProjectsService } from "./agent-projects.service";
import { AgentTasksService } from "./agent-tasks.service";
import { AgentDeliverablesService } from "./agent-deliverables.service";
import { AgentAuditService } from "./agent-audit.service";
import { AgentCommentsService } from "./agent-comments.service";
import { AgentProjectUpdatesService } from "./agent-project-updates.service";
import { AgentProjectNotesService } from "./agent-project-notes.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { ApiKeyService } from "./services/api-key.service";
import { AuditService } from "./services/audit.service";

@Module({
  imports: [PrismaModule, TimeEntriesModule],
  controllers: [
    AgentProjectsController,
    AgentTasksController,
    AgentDeliverablesController,
    AgentCommentsController,
    AgentProjectUpdatesController,
    AgentProjectNotesController,
    AgentAuditController,
  ],
  providers: [
    AgentProjectsService,
    AgentTasksService,
    AgentDeliverablesService,
    AgentCommentsService,
    AgentProjectUpdatesService,
    AgentProjectNotesService,
    AgentAuditService,
    ApiKeyGuard,
    ApiKeyService,
    AuditService,
  ],
})
export class AgentModule {}
