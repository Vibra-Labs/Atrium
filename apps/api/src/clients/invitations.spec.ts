import { describe, expect, it } from "bun:test";
import type { Invitation } from "@atrium/database";
import { isPortalInviteRole, logsInviteLinks, presentInvitations } from "./invitations";

const NOW = new Date("2026-10-14T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const WEB_URL = "https://app.atrium.test";

function row(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv1",
    organizationId: "org1",
    email: "client@acme.test",
    role: "member",
    status: "pending",
    expiresAt: new Date(NOW.getTime() + 5 * DAY_MS),
    inviterId: "owner1",
    createdAt: new Date(NOW.getTime() - DAY_MS),
    reminderSentAt: null,
    ...overrides,
  };
}

describe("presentInvitations", () => {
  it("adds the invite link and marks a live invite as not expired", () => {
    const [inv] = presentInvitations([row()], WEB_URL, NOW);
    expect(inv.inviteLink).toBe("https://app.atrium.test/accept-invite?id=inv1");
    expect(inv.expired).toBe(false);
  });

  it("marks an invite past its expiry as expired", () => {
    const [inv] = presentInvitations([row({ expiresAt: new Date(NOW.getTime() - 1) })], WEB_URL, NOW);
    expect(inv.expired).toBe(true);
  });

  it("hides an expired invite once the same email has been invited again", () => {
    const stale = row({ id: "old", expiresAt: new Date(NOW.getTime() - DAY_MS) });
    const fresh = row({ id: "new", createdAt: NOW, email: "Client@Acme.test" });
    const result = presentInvitations([fresh, stale], WEB_URL, NOW);
    expect(result.map((i) => i.id)).toEqual(["new"]);
  });

  it("keeps the newest of two expired invites for the same email", () => {
    const older = row({ id: "older", createdAt: new Date(NOW.getTime() - 9 * DAY_MS), expiresAt: new Date(NOW.getTime() - 7 * DAY_MS) });
    const newer = row({ id: "newer", createdAt: new Date(NOW.getTime() - 4 * DAY_MS), expiresAt: new Date(NOW.getTime() - 2 * DAY_MS) });
    const result = presentInvitations([newer, older], WEB_URL, NOW);
    expect(result.map((i) => i.id)).toEqual(["newer"]);
  });

  it("keeps an expired invite when there is nothing newer for that email", () => {
    const expired = row({ id: "a", expiresAt: new Date(NOW.getTime() - DAY_MS) });
    const other = row({ id: "b", email: "someone@else.test" });
    expect(presentInvitations([other, expired], WEB_URL, NOW).map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("isPortalInviteRole", () => {
  it("treats member and a missing role as a portal invite, staff roles as not", () => {
    expect(isPortalInviteRole("member")).toBe(true);
    expect(isPortalInviteRole(null)).toBe(true);
    expect(isPortalInviteRole(undefined)).toBe(true);
    expect(isPortalInviteRole("admin")).toBe(false);
    expect(isPortalInviteRole("owner")).toBe(false);
  });
});

describe("logsInviteLinks", () => {
  it("logs invite links only in development", () => {
    expect(logsInviteLinks("development")).toBe(true);
    expect(logsInviteLinks("production")).toBe(false);
    expect(logsInviteLinks("staging")).toBe(false);
    expect(logsInviteLinks("test")).toBe(false);
    expect(logsInviteLinks(undefined)).toBe(false);
  });
});
