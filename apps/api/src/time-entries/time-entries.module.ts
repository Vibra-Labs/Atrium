import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TimeEntriesController } from "./time-entries.controller";
import { TimeEntriesService } from "./time-entries.service";

@Module({
  imports: [PrismaModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
