import { Module } from "@nestjs/common";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { PursuitService } from "./pursuit.service";

@Module({
  imports: [ContactSyncModule, ContactsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, PursuitService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
