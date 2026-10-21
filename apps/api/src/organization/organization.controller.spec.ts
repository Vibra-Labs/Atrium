import { describe, expect, it } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { OrganizationController, type CurrentOrganization } from "./organization.controller";
import type { FullOrganization, OrgMember } from "../common";

const org: FullOrganization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  logo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  metadata: '{"secret":true}',
  members: [
    { id: "m-2", organizationId: "org-1", userId: "u-2", role: "member", createdAt: new Date() },
  ],
};

const member: OrgMember = {
  id: "m-1",
  organizationId: "org-1",
  userId: "u-1",
  role: "member",
  createdAt: new Date(),
};

describe("OrganizationController.current", () => {
  const controller: OrganizationController = new OrganizationController();

  it("returns only the active workspace's public fields and the caller's role", () => {
    const result: CurrentOrganization = controller.current(org, member);
    expect(result).toEqual({ id: "org-1", name: "Acme", slug: "acme", logo: null, role: "member" });
  });

  it("returns an empty slug for a workspace without one", () => {
    const result: CurrentOrganization = controller.current({ ...org, slug: null, logo: "/l.png" }, {
      ...member,
      role: "owner",
    });
    expect(result).toEqual({ id: "org-1", name: "Acme", slug: "", logo: "/l.png", role: "owner" });
  });

  it("refuses a caller with no membership in the active workspace", () => {
    expect(() => controller.current(org, undefined)).toThrow(ForbiddenException);
  });
});
