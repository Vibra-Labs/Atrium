import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { MailModule } from "../mail/mail.module";
import { TrialEmailsTask } from "./trial-emails.task";

// Separate from BillingModule: MailModule depends on Settings, which depends on Billing.
@Module({
  imports: [BillingModule, MailModule],
  providers: [TrialEmailsTask],
})
export class TrialModule {}
