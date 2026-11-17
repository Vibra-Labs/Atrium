import { Controller, ForbiddenException, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentMember, CurrentOrg } from "../common";
import type { FullOrganization, OrgMember } from "../common";
import { DemoService } from "../demo/demo.service";

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: string;
  /**
   * Whether this workspace is the public demo.
   *
   * Decided here rather than from a build-time flag in the web app, because
   * DEMO_MODE is instance-wide while the fence (DemoGuard) is organization-
   * scoped. With the flag alone, any other workspace on the demo host — and
   * every workspace in the e2e suite — saw the demo banner over their own data
   * and an upload button disabled for no reason.
   */
  isDemo: boolean;
}

/**
 * The active workspace for any member, portal clients included. Unlike Better
 * Auth's get-full-organization (staff-only), it never lists other members.
 */
@Controller("organization")
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(private demo: DemoService) {}

  @Get("current")
  async current(
    @CurrentOrg() org: FullOrganization,
    @CurrentMember() member: OrgMember | undefined,
  ): Promise<CurrentOrganization> {
    if (!member) throw new ForbiddenException("Not a member of this workspace");
    return {
      id: org.id,
      name: org.name,
      slug: org.slug ?? "",
      logo: org.logo,
      role: member.role,
      isDemo: await this.demo.isDemoOrg(org.id),
    };
  }
}
