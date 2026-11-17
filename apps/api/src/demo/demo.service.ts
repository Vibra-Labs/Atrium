import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";

/** The two accounts a visitor can enter the demo as. */
export type DemoKind = "owner" | "client";

/**
 * Demo mode lets anonymous visitors sign in to one seeded workspace, so it is
 * off unless `DEMO_MODE` is exactly "true" and belongs only on a throwaway
 * deployment. Every accessor returns null or false while it is off: a
 * half-configured install must not half-enable the demo.
 */
@Injectable()
export class DemoService {
  readonly enabled: boolean;
  private orgId: string | null = null;
  private activityAt: Date | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.enabled = this.config.get("DEMO_MODE") === "true";
  }

  private setting(key: string): string | null {
    if (!this.enabled) return null;
    const value: string | undefined = this.config.get<string>(key);
    return value && value.length > 0 ? value : null;
  }

  get orgSlug(): string | null {
    return this.setting("DEMO_ORG_SLUG");
  }

  get ownerEmail(): string | null {
    return this.setting("DEMO_OWNER_EMAIL");
  }

  get clientEmail(): string | null {
    return this.setting("DEMO_CLIENT_EMAIL");
  }

  /** The address for one entry kind, or null when it isn't configured. */
  addressFor(kind: DemoKind): string | null {
    return kind === "owner" ? this.ownerEmail : this.clientEmail;
  }

  /**
   * Whether an address may be signed in to anonymously. The entry endpoint
   * gates on this, so anything but an exact match on a configured demo address
   * must be false.
   */
  isDemoAddress(email: string): boolean {
    const candidate: string = email.trim().toLowerCase();
    if (candidate.length === 0) return false;
    return [this.ownerEmail, this.clientEmail].some(
      (configured: string | null) => configured !== null && configured.toLowerCase() === candidate,
    );
  }

  /**
   * The demo organization's id, resolved from the configured slug. A hit is
   * memoised; a miss is not, so the id is picked up once the seed has run.
   */
  async demoOrgId(): Promise<string | null> {
    if (this.orgId) return this.orgId;
    const slug: string | null = this.orgSlug;
    if (!slug) return null;
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    this.orgId = organization?.id ?? null;
    return this.orgId;
  }

  async isDemoOrg(organizationId: string | undefined | null): Promise<boolean> {
    if (!organizationId) return false;
    const demoId: string | null = await this.demoOrgId();
    return demoId !== null && demoId === organizationId;
  }

  /** When the demo was last used. The reset skips a window after this. */
  get lastActivityAt(): Date | null {
    return this.activityAt;
  }

  touch(): void {
    this.activityAt = new Date();
  }
}
