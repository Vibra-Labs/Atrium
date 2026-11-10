import { Module } from "@nestjs/common";
import { CostsService } from "./costs.service";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { PursuitService } from "./pursuit.service";
import { PursuitStagesController } from "./pursuit-stages.controller";
import { PursuitStagesService } from "./pursuit-stages.service";
import { InternalItemsService } from "./internal-items.service";

@Module({
  imports: [ContactSyncModule, ContactsModule],
  controllers: [ProjectsController, PursuitStagesController],
  providers: [ProjectsService, PursuitService, PursuitStagesService, InternalItemsService, CostsService],
  exports: [ProjectsService, PursuitService, PursuitStagesService],
})
export class ProjectsModule {}
