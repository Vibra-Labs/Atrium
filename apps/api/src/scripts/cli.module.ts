import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { PrismaModule } from "../prisma/prisma.module";
import { MailModule } from "../mail/mail.module";

/**
 * Just what operator commands need: database, config and mail. No HTTP server
 * and no ScheduleModule, so no cron jobs start while a command runs.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), LoggerModule.forRoot({ pinoHttp: { level: "warn" } }), PrismaModule, MailModule],
})
export class CliModule {}
