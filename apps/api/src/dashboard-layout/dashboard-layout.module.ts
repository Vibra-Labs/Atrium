import { Module } from "@nestjs/common";
import { DashboardLayoutController } from "./dashboard-layout.controller";
import { DashboardLayoutService } from "./dashboard-layout.service";

@Module({
  controllers: [DashboardLayoutController],
  providers: [DashboardLayoutService],
})
export class DashboardLayoutModule {}
