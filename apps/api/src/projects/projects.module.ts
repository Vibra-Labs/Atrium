import { Module } from "@nestjs/common";
import { CostsService } from "./costs.service";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { PursuitService } from "./pursuit.service";
import { InternalItemsService } from "./internal-items.service";

@Module({
  imports: [ContactSyncModule, ContactsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, PursuitService, InternalItemsService, CostsService],
  exports: [ProjectsService, PursuitService],
})
export class ProjectsModule {}
