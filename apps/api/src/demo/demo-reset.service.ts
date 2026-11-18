import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DemoService } from "./demo.service";
import { DEMO_EMAIL_DOMAIN } from "./demo-config";
import { seedDemo } from "./demo-seed";

/** How long after someone used the demo a scheduled reset holds off. */
export const DEMO_QUIET_PERIOD_MS = 5 * 60 * 1000;

/**
 * The longest the workspace may go unreset while people keep using it.
 *
 * The quiet period defers a reset; this stops it cancelling one. Every request
 * touches the demo, reads included, so without a cap a single visitor
 * refreshing once a minute — or any crawler — holds the workspace open
 * indefinitely: visitor content accumulates without bound and the banner
 * counts down to a reset that never arrives. One skipped cycle is a courtesy
 * to whoever is mid-sentence; two is a broken promise.
 */
export const DEMO_MAX_STALENESS_MS = 60 * 60 * 1000;

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
  async reset(): Promise<{ reset: boolean }> {
    if (!this.demo.enabled) throw new NotFoundException("Not found");

    const slug: string | null = this.demo.orgSlug;
    if (!slug) {
      throw new Error("Refusing to reset the demo: DEMO_ORG_SLUG is not set.");
    }

    const now: number = Date.now();
    const lastActivity: Date | null = this.demo.lastActivityAt;
    const inQuietPeriod: boolean =
      lastActivity !== null && now - lastActivity.getTime() < DEMO_QUIET_PERIOD_MS;
    const overdue: boolean = now - this.demo.lastResetAt.getTime() >= DEMO_MAX_STALENESS_MS;
    if (inQuietPeriod && !overdue) {
      this.logger.log("Demo reset deferred: someone is using it.");
      return { reset: false };
    }

    // Re-read rather than trust the memoised id: the row is what gets deleted.
    //
    // The assertion is about the workspace's OWNER, not its slug. Checking the
    // slug would be vacuous — the row was looked up by slug — and the
    // misconfiguration that actually matters is DEMO_ORG_SLUG pointing at a
    // live workspace. An owner on @demo.invalid is something the seed
    // guarantees and a real workspace cannot have, so this is the property
    // worth asserting before anything is deleted. Same contract as
    // test/integration/guard.ts refusing a database not named *_test.
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        members: {
          where: { role: "owner" },
          select: { user: { select: { email: true } } },
        },
      },
    });

    if (organization) {
      const owners: string[] = organization.members.map((member) => member.user.email);
      const allDemoOwners: boolean =
        owners.length > 0 &&
        owners.every((email: string) => email.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN));
      if (!allDemoOwners) {
        throw new Error(
          `Refusing to reset "${slug}" (${organization.id}): its owners are ` +
            `${owners.join(", ") || "(none)"}, which is not a demo account. ` +
            `DEMO_ORG_SLUG looks like it is pointing at a real workspace.`,
        );
      }
    }

    await this.seeder(this.prisma, slug, {
      ownerEmail: this.demo.ownerEmail ?? undefined,
      clientEmail: this.demo.clientEmail ?? undefined,
    });
    this.demo.markReset();
    this.logger.log(`Demo workspace "${slug}" reset.`);
    return { reset: true };
  }
}
