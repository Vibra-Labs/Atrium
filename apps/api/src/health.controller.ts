import { Controller, Get, Query, Res, HttpException, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "./common";
import { PrismaService } from "./prisma/prisma.service";

@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get("domain-check")
  async domainCheck(@Query("domain") domain: string, @Res() res: Response) {
    if (!domain) { res.status(400).send(); return; }
    const org = await this.prisma.organization.findFirst({ where: { customDomain: domain } });
    res.status(org ? 200 : 404).send();
  }

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new HttpException(
        {
          status: "degraded",
          database: "disconnected",
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
