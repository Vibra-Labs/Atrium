import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { ClientsService } from "./clients.service";

const profile = { company: "Acme", phone: "555", address: null, website: null, description: "Bakery" };

function build(contact: { id: string } | null, role = "admin") {
  const contactSync = { ensureForMember: mock(() => Promise.resolve(contact)) };
  const contacts = {
    portalProfile: mock(() => Promise.resolve(profile)),
    updatePortalProfile: mock(() => Promise.resolve(profile)),
  };
  const prisma = { member: { findFirst: mock(() => Promise.resolve({ role })) } };
  const service = new ClientsService(prisma as never, {} as never, contactSync as never, contacts as never);
  return { service, contactSync, contacts };
}

describe("ClientsService profile (stored on the contact)", () => {
  it("reads the caller's own contact, creating it if missing", async () => {
    const { service, contactSync, contacts } = build({ id: "c-1" });
    expect(await service.getProfile("u-1", "org-1")).toEqual(profile);
    expect(contactSync.ensureForMember).toHaveBeenCalledWith("org-1", "u-1");
    expect(contacts.portalProfile).toHaveBeenCalledWith("c-1", "org-1");
  });

  it("staff have no contact, so they read an empty profile", async () => {
    const { service, contacts } = build(null);
    expect(await service.getProfile("u-1", "org-1")).toEqual({
      company: null,
      phone: null,
      address: null,
      website: null,
      description: null,
    });
    expect(contacts.portalProfile).not.toHaveBeenCalled();
  });

  it("writes through to the caller's contact", async () => {
    const { service, contacts } = build({ id: "c-1" });
    await service.updateProfile("u-1", "org-1", { company: "Acme" });
    expect(contacts.updatePortalProfile).toHaveBeenCalledWith("c-1", { company: "Acme" }, "org-1");
  });

  it("staff cannot write a profile", async () => {
    const { service, contacts } = build(null);
    await expect(service.updateProfile("u-1", "org-1", { company: "Acme" })).rejects.toThrow(
      new ForbiddenException("Only portal clients have a profile"),
    );
    expect(contacts.updatePortalProfile).not.toHaveBeenCalled();
  });

  it("a client whose contact can't be linked gets a neutral message, not 'not a client'", async () => {
    const { service, contacts } = build(null, "member");
    await expect(service.updateProfile("u-1", "org-1", { company: "Acme" })).rejects.toThrow(
      new ForbiddenException("Your profile can't be loaded right now"),
    );
    expect(contacts.updatePortalProfile).not.toHaveBeenCalled();
  });
});
