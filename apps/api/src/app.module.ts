import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { IncomingMessage, ServerResponse } from "http";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { FilesModule } from "./files/files.module";
import { BrandingModule } from "./branding/branding.module";
import { MailModule } from "./mail/mail.module";
import { ClientsModule } from "./clients/clients.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { UpdatesModule } from "./updates/updates.module";
import { NotesModule } from "./notes/notes.module";
import { TasksModule } from "./tasks/tasks.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { SettingsModule } from "./settings/settings.module";
import { SetupModule } from "./setup/setup.module";
import { HealthController } from "./health.controller";
import { SessionMiddleware } from "./auth/session.middleware";
import { AllExceptionsFilter } from "./common";
import { CsrfGuard } from "./common/guards/csrf.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
        level: process.env.LOG_LEVEL || "info",
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url === "/api/health",
        },
        serializers: {
          req: (req: IncomingMessage) => ({
            method: req.method,
            url: req.url,
          }),
          res: (res: ServerResponse) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    FilesModule,
    BrandingModule,
    MailModule,
    ClientsModule,
    OnboardingModule,
    UpdatesModule,
    NotesModule,
    TasksModule,
    InvoicesModule,
    SettingsModule,
    SetupModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes("*");
  }
}
