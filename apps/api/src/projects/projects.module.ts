import { Module } from "@nestjs/common";
import { CostsService } from "./costs.service";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { PursuitService } from "./pursuit.service";
import { ProjectStatusesController } from "./project-statuses.controller";
import { ProjectStatusesService } from "./project-statuses.service";
import { PursuitPipelinesController, PursuitStagesController } from "./pursuit-stages.controller";
import { PursuitStagesService } from "./pursuit-stages.service";
import { InternalItemsService } from "./internal-items.service";

@Module({
  imports: [ContactSyncModule, ContactsModule],
  controllers: [ProjectsController, PursuitPipelinesController, PursuitStagesController, ProjectStatusesController],
  providers: [ProjectsService, PursuitService, ProjectStatusesService, PursuitStagesService, InternalItemsService, CostsService],
  exports: [ProjectsService, PursuitService, PursuitStagesService],
})
export class ProjectsModule {}
