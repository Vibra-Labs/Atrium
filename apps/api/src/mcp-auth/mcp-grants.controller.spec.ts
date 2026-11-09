import { describe, expect, it, mock } from "bun:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { McpConsentController, McpGrantsController } from "./mcp-grants.controller";
import type { AuthenticatedRequest } from "../common";

const REQUEST = {
  requestId: "sig1",
  clientId: "c1",
  redirectURI: "http://localhost:9999/callback",
  expiresAt: new Date(Date.now() + 60_000),
};

function build() {
  const service = {
    consentRequest: mock(() => Promise.resolve(REQUEST)),
    getClient: mock(() => Promise.resolve({ clientId: "c1", name: "Claude" })),
    adminOrganizations: mock(() => Promise.resolve([{ id: "org1", name: "Acme" }])),
    savePendingGrant: mock(() => Promise.resolve()),
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
  it("consent-info describes the client, the destination, and the bindable workspaces", async () => {
    const { consent, service } = build();
    const info = await consent.consentInfo("q1", "u1");
    expect(info).toEqual({
      client: { clientId: "c1", name: "Claude" },
      organizations: [{ id: "org1", name: "Acme" }],
      redirect: { display: "an app on this computer", kind: "local" },
    });
    expect(service.consentRequest).toHaveBeenCalledWith("q1");
    // The client is the one the signed request names, never a bare URL parameter.
    expect(service.getClient).toHaveBeenCalledWith("c1");
    expect(service.adminOrganizations).toHaveBeenCalledWith("u1");
  });

  it("consent-info requires the signed request", async () => {
    await expect(build().consent.consentInfo("", "u1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("create parks the choice for the request the signature vouches for", async () => {
    const { consent, service } = build();
    const req = {} as AuthenticatedRequest;
    await consent.create({ oauthQuery: "q1", organizationId: "org1" }, req, "u1");
    expect(service.consentRequest).toHaveBeenCalledWith("q1");
    expect(service.savePendingGrant).toHaveBeenCalledWith(REQUEST, "u1", "org1");
  });

  it("refuses to create a grant when the request itself used an API key", async () => {
    const { consent, service } = build();
    const req = { apiKeyId: "k0" } as AuthenticatedRequest;
    let error: Error | null = null;
    try {
      await consent.create({ oauthQuery: "q1", organizationId: "org1" }, req, "u1");
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(service.consentRequest).not.toHaveBeenCalled();
    expect(service.savePendingGrant).not.toHaveBeenCalled();
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
