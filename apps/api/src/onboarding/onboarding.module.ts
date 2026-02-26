import { Module } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";

@Module({
  imports: [AuthModule, MailModule],
  controllers: [OnboardingController],
})
export class OnboardingModule {}
