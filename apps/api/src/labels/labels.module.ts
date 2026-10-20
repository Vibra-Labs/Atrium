import { Module } from "@nestjs/common";
import { LabelsController } from "./labels.controller";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { LabelsService } from "./labels.service";

@Module({
  imports: [ContactSyncModule],
  controllers: [LabelsController],
  providers: [LabelsService],
})
export class LabelsModule {}
