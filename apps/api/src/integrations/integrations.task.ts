import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { IntegrationDispatcher } from "./integration-dispatcher.service";

@Injectable()
export class IntegrationsTask {
  private readonly logger = new Logger(IntegrationsTask.name);

  constructor(private dispatcher: IntegrationDispatcher) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async retryDue(): Promise<void> {
    try {
      await this.dispatcher.processDue();
    } catch (err) {
      this.logger.error("Failed to process integration retries", err instanceof Error ? err.stack : String(err));
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    try {
      const count: number = await this.dispatcher.pruneOld();
      if (count > 0) this.logger.log(`Pruned ${count} old integration deliveries`);
    } catch (err) {
      this.logger.error("Failed to prune integration deliveries", err instanceof Error ? err.stack : String(err));
    }
  }
}
