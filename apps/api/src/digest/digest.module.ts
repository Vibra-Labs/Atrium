import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { MondayDigestService } from "./monday-digest.service";
import { MondayDigestTask } from "./monday-digest.task";
import { EmailPreferencesService } from "./email-preferences.service";
import { EmailPreferencesController } from "./email-preferences.controller";

@Module({
  imports: [MailModule],
  controllers: [EmailPreferencesController],
  providers: [MondayDigestService, MondayDigestTask, EmailPreferencesService],
})
export class DigestModule {}
