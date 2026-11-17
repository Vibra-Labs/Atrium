import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DemoService } from "./demo.service";
import { DemoResetService } from "./demo-reset.service";

/** Puts the demo workspace back to its seeded state twice an hour. */
@Injectable()
export class DemoResetTask {
  private readonly logger = new Logger(DemoResetTask.name);

  constructor(
    private demo: DemoService,
    private resetService: DemoResetService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    if (!this.demo.enabled) return;
    try {
      await this.resetService.reset();
    } catch (error) {
      // A failed reset must not stop the schedule; the next run tries again.
      this.logger.error(
        `Demo reset failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
