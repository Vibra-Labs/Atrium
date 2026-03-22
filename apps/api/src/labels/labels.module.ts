import { Module } from "@nestjs/common";
import { LabelsController } from "./labels.controller";
import { LabelsService } from "./labels.service";

@Module({
  controllers: [LabelsController],
  providers: [LabelsService],
})
export class LabelsModule {}
