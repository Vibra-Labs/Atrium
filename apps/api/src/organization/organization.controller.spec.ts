import { describe, expect, it } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { OrganizationController, type CurrentOrganization } from "./organization.controller";
import type { FullOrganization, OrgMember } from "../common";
import type { DemoService } from "../demo/demo.service";

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

function demoService(demoOrgId: string | null): DemoService {
  return {
    isDemoOrg: (id: string | undefined | null) =>
      Promise.resolve(demoOrgId !== null && id === demoOrgId),
  } as unknown as DemoService;
}

describe("OrganizationController.current", () => {
  const controller: OrganizationController = new OrganizationController(demoService(null));

  it("returns only the active workspace's public fields and the caller's role", async () => {
    const result: CurrentOrganization = await controller.current(org, member);
    expect(result).toEqual({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      logo: null,
      role: "member",
      isDemo: false,
    });
  });

  it("returns an empty slug for a workspace without one", async () => {
    const result: CurrentOrganization = await controller.current({ ...org, slug: null, logo: "/l.png" }, {
      ...member,
      role: "owner",
    });
    expect(result).toEqual({
      id: "org-1",
      name: "Acme",
      slug: "",
      logo: "/l.png",
      role: "owner",
      isDemo: false,
    });
  });

  it("refuses a caller with no membership in the active workspace", async () => {
    await expect(controller.current(org, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("tells the web app when this workspace is the demo, so the banner is org-scoped", async () => {
    // The banner used to come from DEMO_MODE alone, which is instance-wide,
    // while the API fence is org-scoped. On a host serving anything besides the
    // demo -- including the whole e2e suite -- every workspace got the demo
    // banner and a disabled upload button on their own data.
    const inDemo = new OrganizationController(demoService("org-1"));

    expect((await inDemo.current(org, member)).isDemo).toBe(true);
    expect((await inDemo.current({ ...org, id: "org-other" }, member)).isDemo).toBe(false);
  });
});
