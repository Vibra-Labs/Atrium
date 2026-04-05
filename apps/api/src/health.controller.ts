import { Controller, Get, Query, Req, Res, HttpException, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { Public } from "./common";
import { PrismaService } from "./prisma/prisma.service";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Public()
  @Get("config")
  getConfig() {
    return {
      billingEnabled: this.config.get("BILLING_ENABLED") === "true",
    };
  }

  @Public()
  @Get("domain-check")
  async domainCheck(
    @Query("domain") domain: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Only Caddy (running on the same host) should call this endpoint.
    // Reject any request not originating from loopback to prevent enumeration.
    //
    // TOPOLOGY NOTE: This loopback guard assumes Caddy and the API process share
    // the same network namespace (e.g. same container or same host). If the
    // deployment is split so that Caddy runs in a separate container/host and
    // reaches the API over a private network, `remoteAddress` will NOT be a
    // loopback address and every request will receive 403. In that case, replace
    // the loopback check with a shared secret header validated here.
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
