import { Controller, ForbiddenException, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentMember, CurrentOrg } from "../common";
import type { FullOrganization, OrgMember } from "../common";

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: string;
}

/**
 * The active workspace for any member, portal clients included. Unlike Better
 * Auth's get-full-organization (staff-only), it never lists other members.
 */
@Controller("organization")
@UseGuards(AuthGuard)
export class OrganizationController {
  @Get("current")
  current(
    @CurrentOrg() org: FullOrganization,
    @CurrentMember() member: OrgMember | undefined,
  ): CurrentOrganization {
    if (!member) throw new ForbiddenException("Not a member of this workspace");
    return {
      id: org.id,
      name: org.name,
      slug: org.slug ?? "",
      logo: org.logo,
      role: member.role,
    };
  }
}
