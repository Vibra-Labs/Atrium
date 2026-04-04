import { Controller, Get, Query, Req, Res, HttpException, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "./common";
import { PrismaService } from "./prisma/prisma.service";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get("domain-check")
  async domainCheck(
    @Query("domain") domain: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Only Caddy (running on the same host) should call this endpoint.
    // Reject any request not originating from loopback to prevent enumeration.
    const remoteIp = req.socket.remoteAddress ?? "";
    if (!LOOPBACK.has(remoteIp)) { res.status(403).send(); return; }
    if (!domain) { res.status(400).send(); return; }
    const org = await this.prisma.organization.findUnique({ where: { customDomain: domain } });
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
