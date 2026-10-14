import { Module } from "@nestjs/common";
import { MailService } from "./mail.service";
import { EmailRenderer } from "./email-renderer";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [SettingsModule],
  providers: [MailService, EmailRenderer],
  exports: [MailService, EmailRenderer],
})
export class MailModule {}
