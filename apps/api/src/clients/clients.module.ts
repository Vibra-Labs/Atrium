import { Module } from "@nestjs/common";
import { ClientsController } from "./clients.controller";
import { ClientsService } from "./clients.service";
import { InvitationReminderTask } from "./invitation-reminder.task";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [ContactSyncModule, ContactsModule, AuthModule, MailModule],
  controllers: [ClientsController],
  providers: [ClientsService, InvitationReminderTask],
  exports: [ClientsService],
})
export class ClientsModule {}
