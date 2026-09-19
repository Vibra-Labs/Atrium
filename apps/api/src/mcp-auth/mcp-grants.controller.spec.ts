import { describe, expect, it, mock } from "bun:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { McpConsentController, McpGrantsController } from "./mcp-grants.controller";
import type { AuthenticatedRequest } from "../common";

function build() {
  const service = {
    getClient: mock(() => Promise.resolve({ clientId: "c1", name: "Claude", icon: null })),
    adminOrganizations: mock(() => Promise.resolve([{ id: "org1", name: "Acme" }])),
    saveGrant: mock(() => Promise.resolve()),
    listGrants: mock(() => Promise.resolve([])),
    revokeGrant: mock(() => Promise.resolve()),
  };
  return {
    service,
    consent: new McpConsentController(service as never),
    grants: new McpGrantsController(service as never),
  };
}

describe("MCP grants controllers", () => {
  it("consent-info returns the client and the workspaces the user may bind", async () => {
    const { consent, service } = build();
    const info = await consent.consentInfo("c1", "u1");
    expect(info).toEqual({
      client: { clientId: "c1", name: "Claude", icon: null },
      organizations: [{ id: "org1", name: "Acme" }],
    });
    expect(service.adminOrganizations).toHaveBeenCalledWith("u1");
  });

  it("consent-info requires clientId", async () => {
    await expect(build().consent.consentInfo("", "u1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("create saves the grant for the signed-in user", async () => {
    const { consent, service } = build();
    const req = {} as AuthenticatedRequest;
    await consent.create({ clientId: "c1", organizationId: "org1" }, req, "u1");
    expect(service.saveGrant).toHaveBeenCalledWith("u1", "c1", "org1");
  });

  it("refuses to create a grant when the request itself used an API key", async () => {
    const { consent, service } = build();
    const req = { apiKeyId: "k0" } as AuthenticatedRequest;
    let error: Error | null = null;
    try {
      await consent.create({ clientId: "c1", organizationId: "org1" }, req, "u1");
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(service.saveGrant).not.toHaveBeenCalled();
  });

  it("list and revoke pass the caller's identity and role", async () => {
    const { grants, service } = build();
    await grants.list("u1", "org1", "admin");
    const req = {} as AuthenticatedRequest;
    await grants.revoke("g1", req, "u1", "org1", "owner");
    expect(service.listGrants).toHaveBeenCalledWith("u1", "org1", "admin");
    expect(service.revokeGrant).toHaveBeenCalledWith("g1", "u1", "org1", "owner");
  });

  it("refuses to revoke a grant when the request itself used an API key", async () => {
    const { grants, service } = build();
    const req = { apiKeyId: "k0" } as AuthenticatedRequest;
    let error: Error | null = null;
    try {
      await grants.revoke("g1", req, "u1", "org1", "owner");
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(service.revokeGrant).not.toHaveBeenCalled();
  });
});
