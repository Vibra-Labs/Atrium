import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TimeEntriesController } from "./time-entries.controller";
import { TimeEntriesService } from "./time-entries.service";
import { TimeEntryCaptureService } from "./time-entry-capture.service";

@Module({
  imports: [PrismaModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService, TimeEntryCaptureService],
  exports: [TimeEntriesService, TimeEntryCaptureService],
})
export class TimeEntriesModule {}
