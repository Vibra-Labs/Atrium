import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ActivityService } from "./activity.service";

@Module({
  imports: [PrismaModule],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
