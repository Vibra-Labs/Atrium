import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";

@Module({
  imports: [PrismaModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
