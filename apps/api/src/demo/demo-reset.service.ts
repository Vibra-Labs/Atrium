import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DemoService } from "./demo.service";
import { seedDemo } from "@atrium/database";

/** How long after someone used the demo a scheduled reset holds off. */
export const DEMO_QUIET_PERIOD_MS = 5 * 60 * 1000;

export type DemoSeeder = typeof seedDemo;

@Injectable()
export class DemoResetService {
  private readonly logger = new Logger(DemoResetService.name);

  constructor(
    private prisma: PrismaService,
    private demo: DemoService,
    /** Injectable so the refusal paths can be proven without a database. */
    @Optional() @Inject("DEMO_SEEDER") private seeder: DemoSeeder = seedDemo,
  ) {}

  /**
   * Wipes the demo workspace's contents and reseeds it.
   *
   * Refuses unless it can confirm the target is the configured demo
   * organization — the same contract as the integration-test database guard,
   * and for the same reason: the operation is destructive and a
   * misconfiguration must fail closed rather than delete a real workspace.
   */
  async reset(options: { force?: boolean } = {}): Promise<{ reset: boolean }> {
    if (!this.demo.enabled) throw new NotFoundException("Not found");

    const slug: string | null = this.demo.orgSlug;
    if (!slug) {
      throw new Error("Refusing to reset the demo: DEMO_ORG_SLUG is not set.");
    }

    if (!options.force) {
      const lastActivity: Date | null = this.demo.lastActivityAt;
      if (lastActivity && Date.now() - lastActivity.getTime() < DEMO_QUIET_PERIOD_MS) {
        this.logger.log("Demo reset skipped: someone is using it.");
        return { reset: false };
      }
    }

    // Re-read rather than trust the memoised id: the row is what gets deleted.
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
    if (organization && organization.slug !== slug) {
      throw new Error(
        `Refusing to reset the demo: organization ${organization.id} has slug ` +
          `"${organization.slug}", not the configured demo slug "${slug}".`,
      );
    }

    await this.seeder(this.prisma, slug, {
      ownerEmail: this.demo.ownerEmail ?? undefined,
      clientEmail: this.demo.clientEmail ?? undefined,
    });
    this.logger.log(`Demo workspace "${slug}" reset.`);
    return { reset: true };
  }
}
