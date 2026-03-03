import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// Load root .env before NestJS bootstraps (Turbo runs from apps/api/)
function loadEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] !== undefined) continue; // don't override existing
    let val = trimmed.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnv(resolve(process.cwd(), "../../.env"));
loadEnv(resolve(process.cwd(), ".env"));

const required = ["DATABASE_URL", "BETTER_AUTH_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Auth secret validation
const DEFAULT_SECRET = "change-me-in-production";
const authSecret = process.env.BETTER_AUTH_SECRET!;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  if (authSecret === DEFAULT_SECRET) {
    console.error(
      "FATAL: BETTER_AUTH_SECRET is set to the default value. " +
        "You must change it before running in production.",
    );
    process.exit(1);
  }
  if (authSecret.length < 32) {
    console.error(
      "FATAL: BETTER_AUTH_SECRET must be at least 32 characters in production. " +
        `Current length: ${authSecret.length}`,
    );
    process.exit(1);
  }
} else {
  if (authSecret === DEFAULT_SECRET) {
    console.warn(
      "WARNING: BETTER_AUTH_SECRET is set to the default value. " +
        "Change it before deploying to production.",
    );
  }
}

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import cookieParser from "cookie-parser";
import helmet from "helmet";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.use(cookieParser());

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", process.env.WEB_URL || "http://localhost:3000"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    origin: process.env.WEB_URL || "http://localhost:3000",
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix("api");

  const port = process.env.PORT || 3001;
  await app.listen(port);
  app.get(Logger).log(`Atrium API running on http://localhost:${port}`);
}

bootstrap();
