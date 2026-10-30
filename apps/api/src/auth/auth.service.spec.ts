import { describe, expect, it, mock, beforeEach } from "bun:test";
import "../common/testing/mock-email";
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { AuthService } from "./auth.service";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { MailService } from "../mail/mail.service";
import type { BillingService } from "../billing/billing.service";

// Mutable so individual tests can flip the deploy between open and locked down.
let allowSignups: string | undefined;
let resendApiKey: string | undefined;

const mockConfig = {
  get: mock((key: string, fallback?: string) => {
    if (key === "WEB_URL") return "http://localhost:3000";
    if (key === "API_URL") return "http://localhost:3001";
    if (key === "ALLOW_SIGNUPS") return allowSignups;
    if (key === "RESEND_API_KEY") return resendApiKey;
    return fallback;
  }),
  getOrThrow: mock((key: string) => {
    if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
    throw new Error(`Missing ${key}`);
  }),
};

const mockPrisma = {
  member: {
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
  },
  projectClient: {
    count: mock(() => Promise.resolve(0)),
  },
  user: {
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock((): Promise<unknown> => Promise.resolve(null)),
  },
  invitation: {
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock((): Promise<unknown> => Promise.resolve(null)),
  },
  contact: {
    findFirst: mock((): Promise<unknown> => Promise.resolve(null)),
  },
  organization: {
    findUnique: mock((): Promise<unknown> => Promise.resolve(null)),
  },
  systemSettings: {
    count: mock((): Promise<number> => Promise.resolve(0)),
  },
};

const mockMail = { send: mock(() => Promise.resolve()) };
const mockBilling = {
  initializeFreePlan: mock(() => Promise.resolve()),
  assertPlanLimit: mock((): Promise<void> => Promise.resolve()),
  hasFeature: mock((): Promise<boolean> => Promise.resolve(true)),
};

function makeService(): AuthService {
  return new AuthService(
    mockConfig as unknown as ConfigService,
    mockPrisma as unknown as PrismaService,
    mockMail as unknown as MailService,
    mockBilling as unknown as BillingService,
    {} as never,
  );
}

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(() => {
    service = makeService();
    mockPrisma.member.findFirst.mockClear();
    mockPrisma.member.findMany.mockClear();
    mockPrisma.projectClient.count.mockClear();
    mockPrisma.user.findUnique.mockClear();
    mockPrisma.invitation.findFirst.mockClear();
    mockPrisma.invitation.findUnique.mockReset();
    mockPrisma.invitation.findUnique.mockImplementation(() => Promise.resolve(null));
    mockPrisma.user.findFirst.mockReset();
    mockPrisma.user.findFirst.mockImplementation(() => Promise.resolve(null));
    mockPrisma.contact.findFirst.mockReset();
    mockPrisma.contact.findFirst.mockImplementation(() => Promise.resolve(null));
    mockPrisma.organization.findUnique.mockReset();
    mockPrisma.organization.findUnique.mockImplementation(() => Promise.resolve(null));
    mockPrisma.systemSettings.count.mockReset();
    mockPrisma.systemSettings.count.mockImplementation(() => Promise.resolve(0));
    mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve(null));
    mockBilling.hasFeature.mockReset();
    mockBilling.hasFeature.mockImplementation(() => Promise.resolve(true));
    mockMail.send.mockClear();
    mockConfig.get.mockClear();
    allowSignups = undefined;
    resendApiKey = undefined;
  });

  describe("maySignUp", () => {
    it("allows anyone when ALLOW_SIGNUPS is unset", async () => {
      expect(await service.maySignUp("stranger@example.com")).toBe(true);
      expect(mockPrisma.invitation.findFirst).not.toHaveBeenCalled();
    });

    it("allows anyone when ALLOW_SIGNUPS is explicitly true", async () => {
      allowSignups = "true";

      expect(await service.maySignUp("stranger@example.com")).toBe(true);
      expect(mockPrisma.invitation.findFirst).not.toHaveBeenCalled();
    });

    it("refuses an uninvited stranger when signups are disabled", async () => {
      allowSignups = "false";
      mockPrisma.invitation.findFirst.mockReturnValueOnce(
        Promise.resolve(null),
      );

      expect(await service.maySignUp("stranger@example.com")).toBe(false);
    });

    it("allows an invited client through even when signups are disabled", async () => {
      allowSignups = "false";
      mockPrisma.invitation.findFirst.mockReturnValueOnce(
        Promise.resolve({ id: "inv-1" }),
      );

      expect(await service.maySignUp("client@acme.com")).toBe(true);
    });

    it("only counts invitations that are pending and unexpired", async () => {
      allowSignups = "false";
      mockPrisma.invitation.findFirst.mockReturnValueOnce(
        Promise.resolve(null),
      );

      await service.maySignUp("client@acme.com");

      const call = mockPrisma.invitation.findFirst.mock.calls[0][0] as {
        where: {
          email: { equals: string; mode: string };
          status: string;
          expiresAt: { gt: Date };
        };
      };
      expect(call.where.status).toBe("pending");
      expect(call.where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it("matches the invitation email case-insensitively", async () => {
      allowSignups = "false";
      mockPrisma.invitation.findFirst.mockReturnValueOnce(
        Promise.resolve({ id: "inv-1" }),
      );

      expect(await service.maySignUp("Client@Acme.com")).toBe(true);

      const call = mockPrisma.invitation.findFirst.mock.calls[0][0] as {
        where: { email: { equals: string; mode: string } };
      };
      expect(call.where.email.mode).toBe("insensitive");
    });

    it("fails closed when the invitation lookup errors", async () => {
      allowSignups = "false";
      mockPrisma.invitation.findFirst.mockReturnValueOnce(
        Promise.reject(new Error("db down")),
      );

      expect(await service.maySignUp("client@acme.com")).toBe(false);
    });
  });

  describe("getPrimaryOrgForUserId", () => {
    it("returns the most recent membership organizationId", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.resolve({ organizationId: "org-123" }),
      );

      const result = await service.getPrimaryOrgForUserId("user-1");

      expect(result).toBe("org-123");
      const call = mockPrisma.member.findFirst.mock.calls[0][0] as {
        where: { userId: string };
        orderBy: { createdAt: string };
      };
      expect(call.where).toEqual({ userId: "user-1" });
      expect(call.orderBy).toEqual({ createdAt: "desc" });
    });

    it("returns undefined when the user has no memberships", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(Promise.resolve(null));

      const result = await service.getPrimaryOrgForUserId("user-orphan");

      expect(result).toBeUndefined();
    });

    it("returns undefined and swallows errors when the query fails", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.reject(new Error("db down")),
      );

      const result = await service.getPrimaryOrgForUserId("user-1");

      expect(result).toBeUndefined();
    });
  });

  describe("getPreferredActiveOrgForUserId", () => {
    it("prefers an owner/admin membership over a client one", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.resolve({ organizationId: "org-i-run" }),
      );

      expect(await service.getPreferredActiveOrgForUserId("u1")).toBe(
        "org-i-run",
      );
      const where = mockPrisma.member.findFirst.mock.calls[0][0] as {
        where: { role: { in: string[] } };
      };
      expect(where.where.role.in).toEqual(["owner", "admin"]);
    });

    it("falls back to any membership when the user runs nothing", async () => {
      mockPrisma.member.findFirst
        .mockReturnValueOnce(Promise.resolve(null))
        .mockReturnValueOnce(Promise.resolve({ organizationId: "org-client" }));

      expect(await service.getPreferredActiveOrgForUserId("u1")).toBe(
        "org-client",
      );
    });

    it("returns undefined for a user with no memberships", async () => {
      mockPrisma.member.findFirst
        .mockReturnValueOnce(Promise.resolve(null))
        .mockReturnValueOnce(Promise.resolve(null));

      expect(await service.getPreferredActiveOrgForUserId("u1")).toBeUndefined();
    });

    it("returns undefined rather than throwing on a DB error", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.reject(new Error("boom")),
      );

      expect(await service.getPreferredActiveOrgForUserId("u1")).toBeUndefined();
    });
  });

  describe("getPrimaryOrgForEmail", () => {
    it("resolves orgId via a single member query joined on user.email", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.resolve({ organizationId: "org-456" }),
      );

      const result = await service.getPrimaryOrgForEmail("alice@example.com");

      expect(result).toBe("org-456");
      const call = mockPrisma.member.findFirst.mock.calls[0][0] as {
        where: { user: { email: string } };
      };
      expect(call.where).toEqual({ user: { email: "alice@example.com" } });
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns undefined when no membership matches the email", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(Promise.resolve(null));

      const result = await service.getPrimaryOrgForEmail("ghost@example.com");

      expect(result).toBeUndefined();
    });

    it("returns undefined and swallows errors when the query fails", async () => {
      mockPrisma.member.findFirst.mockReturnValueOnce(
        Promise.reject(new Error("db down")),
      );

      const result = await service.getPrimaryOrgForEmail("alice@example.com");

      expect(result).toBeUndefined();
    });
  });

  describe("generateResetLink", () => {
    it("returns the URL and emailSent captured from the sendResetPassword callback context", async () => {
      const expectedUrl =
        "http://localhost:3001/api/auth/reset-password/token-abc?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password";

      const requestPasswordReset = mock(async () => {
        const store = (
          service as unknown as {
            adminResetStorage: {
              getStore: () => {
                capturedUrl: string | null;
                emailSent: boolean;
                emailViaOrgConfig: boolean;
              } | undefined;
            };
          }
        ).adminResetStorage.getStore();
        if (store) {
          store.capturedUrl = expectedUrl;
          store.emailSent = true;
          store.emailViaOrgConfig = true;
        }
      });
      (service.auth as unknown as {
        api: { requestPasswordReset: typeof requestPasswordReset };
      }).api.requestPasswordReset = requestPasswordReset;

      const result = await service.generateResetLink("alice@example.com");

      expect(result).toEqual({
        url: expectedUrl,
        emailSent: true,
        emailViaOrgConfig: true,
      });
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
      const callArg = requestPasswordReset.mock.calls[0][0] as {
        body: { email: string; redirectTo: string };
      };
      expect(callArg.body.email).toBe("alice@example.com");
      expect(callArg.body.redirectTo).toBe("http://localhost:3000/reset-password");
    });

    it("returns emailSent=false when no provider sent the email", async () => {
      const requestPasswordReset = mock(async () => {
        const store = (
          service as unknown as {
            adminResetStorage: {
              getStore: () => {
                capturedUrl: string | null;
                emailSent: boolean;
                emailViaOrgConfig: boolean;
              } | undefined;
            };
          }
        ).adminResetStorage.getStore();
        if (store) {
          store.capturedUrl = "https://example.test/reset/abc";
          // emailSent and emailViaOrgConfig stay false
        }
      });
      (service.auth as unknown as {
        api: { requestPasswordReset: typeof requestPasswordReset };
      }).api.requestPasswordReset = requestPasswordReset;

      const result = await service.generateResetLink("alice@example.com");

      expect(result.emailSent).toBe(false);
      expect(result.emailViaOrgConfig).toBe(false);
    });

    it("throws InternalServerErrorException when no URL was captured", async () => {
      (service.auth as unknown as {
        api: { requestPasswordReset: () => Promise<void> };
      }).api.requestPasswordReset = mock(async () => {
        // intentionally do not populate the ALS context
      });

      await expect(service.generateResetLink("ghost@example.com")).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

  });

  describe("organization creation gate", () => {
    function makeServiceWith(allowSignups: string | undefined): AuthService {
      const config = {
        get: mock((key: string, fallback?: string) => {
          if (key === "WEB_URL") return "http://localhost:3000";
          if (key === "API_URL") return "http://localhost:3001";
          if (key === "ALLOW_SIGNUPS") return allowSignups;
          return fallback;
        }),
        getOrThrow: mock((key: string) => {
          if (key === "BETTER_AUTH_SECRET") return "x".repeat(32);
          throw new Error(`Missing ${key}`);
        }),
      };
      return new AuthService(
        config as unknown as ConfigService,
        mockPrisma as unknown as PrismaService,
        mockMail as unknown as MailService,
        mockBilling as unknown as BillingService,
        {} as never,
      );
    }

    function orgCreateOption(service: AuthService): unknown {
      interface OrgPlugin {
        id: string;
        options?: { allowUserToCreateOrganization?: unknown };
      }
      interface AuthWithOptions {
        options: { plugins: OrgPlugin[] };
      }
      const plugins = (service.auth as unknown as AuthWithOptions).options.plugins;
      return plugins.find((p) => p.id === "organization")?.options
        ?.allowUserToCreateOrganization;
    }

    function gate(
      service: AuthService,
    ): (user: { id: string }) => Promise<boolean> {
      return orgCreateOption(service) as (user: {
        id: string;
      }) => Promise<boolean>;
    }

    it("blocks org creation when ALLOW_SIGNUPS is 'false' without querying", async () => {
      // No fixture queued on purpose: the gate must short-circuit before any
      // DB access. (A queued-but-unconsumed once-value would also survive
      // mockClear and shift every later test's fixture by one.)
      expect(await gate(makeServiceWith("false"))({ id: "u1" })).toBe(false);
      expect(mockPrisma.member.findMany).not.toHaveBeenCalled();
    });

    it("lets an owner create another org", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(
        Promise.resolve([{ role: "owner" }]),
      );

      expect(await gate(makeServiceWith(undefined))({ id: "owner-1" })).toBe(
        true,
      );
    });

    it("lets an admin create an org", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(
        Promise.resolve([{ role: "admin" }]),
      );

      expect(await gate(makeServiceWith(undefined))({ id: "admin-1" })).toBe(
        true,
      );
    });

    it("lets a brand-new signup create their first org (no rows at all)", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(Promise.resolve([]));
      mockPrisma.projectClient.count.mockReturnValueOnce(Promise.resolve(0));

      expect(await gate(makeServiceWith(undefined))({ id: "new-1" })).toBe(
        true,
      );
    });

    // Portal clients are invited with role "member" and therefore DO hold a
    // Member row. This is the case the original gate got wrong: it treated any
    // membership as staff and let every client through.
    it("blocks a portal client whose only membership is role 'member'", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(
        Promise.resolve([{ role: "member" }]),
      );

      expect(
        await gate(makeServiceWith(undefined))({ id: "client-1" }),
      ).toBe(false);
      expect(mockPrisma.projectClient.count).not.toHaveBeenCalled();
    });

    it("blocks a client of several orgs (all role 'member')", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(
        Promise.resolve([{ role: "member" }, { role: "member" }]),
      );

      expect(
        await gate(makeServiceWith(undefined))({ id: "client-2" }),
      ).toBe(false);
    });

    it("blocks a user with no membership but a ProjectClient row", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(Promise.resolve([]));
      mockPrisma.projectClient.count.mockReturnValueOnce(Promise.resolve(2));

      expect(
        await gate(makeServiceWith(undefined))({ id: "client-3" }),
      ).toBe(false);
    });

    it("allows someone who is a client of one org but an owner of another", async () => {
      mockPrisma.member.findMany.mockReturnValueOnce(
        Promise.resolve([{ role: "member" }, { role: "owner" }]),
      );

      expect(await gate(makeServiceWith(undefined))({ id: "mixed-1" })).toBe(
        true,
      );
    });
  });

  describe("generateResetLink (ALS isolation)", () => {
    it("isolates ALS contexts so concurrent generates do not bleed URLs", async () => {
      let call = 0;
      (service.auth as unknown as {
        api: { requestPasswordReset: (args: { body: { email: string } }) => Promise<void> };
      }).api.requestPasswordReset = mock(async ({ body }) => {
        const store = (
          service as unknown as {
            adminResetStorage: {
              getStore: () => {
                capturedUrl: string | null;
                emailSent: boolean;
                emailViaOrgConfig: boolean;
              } | undefined;
            };
          }
        ).adminResetStorage.getStore();
        await new Promise((r) => setTimeout(r, ++call * 5));
        if (store) {
          store.capturedUrl = `https://example.test/reset/${body.email}`;
          store.emailSent = true;
          store.emailViaOrgConfig = true;
        }
      });

      const [a, b] = await Promise.all([
        service.generateResetLink("a@example.com"),
        service.generateResetLink("b@example.com"),
      ]);

      expect(a.url).toBe("https://example.test/reset/a@example.com");
      expect(b.url).toBe("https://example.test/reset/b@example.com");
    });
  });

  describe("assertInviteWithinPlan", () => {
    beforeEach(() => mockBilling.assertPlanLimit.mockReset());

    it("checks the clients limit for client invites and the members limit for staff", async () => {
      mockBilling.assertPlanLimit.mockResolvedValue(undefined);
      await service.assertInviteWithinPlan("org-1", "member");
      expect(mockBilling.assertPlanLimit).toHaveBeenCalledWith("org-1", "clients", 0);
      await service.assertInviteWithinPlan("org-1", "admin");
      expect(mockBilling.assertPlanLimit).toHaveBeenCalledWith("org-1", "members", 0);
      // Accepting: the invite itself is still pending, so one seat is reserved out of the count.
      await service.assertInviteWithinPlan("org-1", "member", 1);
      expect(mockBilling.assertPlanLimit).toHaveBeenCalledWith("org-1", "clients", 1);
    });

    it("turns the plan limit into a Better Auth error so the invite route returns 403", async () => {
      mockBilling.assertPlanLimit.mockRejectedValue(new ForbiddenException("You've reached the clients limit (5/5) on your Free plan. Please upgrade to continue."));
      const err = await service.assertInviteWithinPlan("org-1", "member").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe("FORBIDDEN");
      expect((err as APIError).message).toContain("clients limit (5/5)");
    });
  });
  describe("membership hooks keep contacts in sync", () => {
    interface MemberHookArgs {
      member: { id: string; userId: string; organizationId: string; role: string };
      previousRole?: string;
    }
    type Hook = (data: MemberHookArgs) => Promise<void>;
    interface OrgPlugin {
      id: string;
      options?: { organizationHooks?: Record<string, Hook> };
    }

    const sync = {
      detachMember: mock((): Promise<void> => Promise.resolve()),
      syncRoleChange: mock((): Promise<void> => Promise.resolve()),
    };

    function hook(name: string): Hook {
      sync.detachMember.mockClear();
      sync.syncRoleChange.mockClear();
      const svc = new AuthService(
        mockConfig as unknown as ConfigService,
        mockPrisma as unknown as PrismaService,
        mockMail as unknown as MailService,
        mockBilling as unknown as BillingService,
        sync as never,
      );
      const plugins = (svc.auth as unknown as { options: { plugins: OrgPlugin[] } }).options.plugins;
      const fn = plugins.find((p) => p.id === "organization")?.options?.organizationHooks?.[name];
      if (!fn) throw new Error(`missing hook ${name}`);
      return fn;
    }

    const client = { id: "m-1", userId: "u-1", organizationId: "org-1", role: "member" };

    it("afterRemoveMember detaches a removed client's contact", async () => {
      await hook("afterRemoveMember")({ member: client });
      expect(sync.detachMember).toHaveBeenCalledWith("org-1", "u-1");
    });

    it("afterRemoveMember ignores staff", async () => {
      await hook("afterRemoveMember")({ member: { ...client, role: "admin" } });
      expect(sync.detachMember).not.toHaveBeenCalled();
    });

    it("afterRemoveMember swallows sync errors", async () => {
      const fn = hook("afterRemoveMember");
      sync.detachMember.mockImplementationOnce(() => Promise.reject(new Error("db down")));
      await fn({ member: client });
    });

    it("afterUpdateMemberRole syncs the contact for the role change", async () => {
      await hook("afterUpdateMemberRole")({ member: { ...client, role: "admin" }, previousRole: "member" });
      expect(sync.syncRoleChange).toHaveBeenCalledWith("org-1", "u-1", "member", "admin");
    });
  });

  describe("passwordless invitations", () => {
    const future: Date = new Date(Date.now() + 86_400_000);
    const portalInvite = {
      id: "inv-1",
      email: "jane@acme.com",
      role: "member",
      status: "pending",
      expiresAt: future,
      organizationId: "org-1",
      organization: { name: "Acme Agency" },
    };

    type SignInCall = { body: { email: string; name?: string; callbackURL: string; errorCallbackURL: string } };

    /** Stands in for Better Auth: hands the verify URL to sendMagicLink, as the plugin does. */
    function stubSignInMagicLink(): ReturnType<typeof mock> {
      const signInMagicLink = mock(async (call: SignInCall) => {
        await service.deliverMagicLink(
          call.body.email,
          `http://localhost:3001/api/auth/magic-link/verify?token=tok-1&callbackURL=${encodeURIComponent(call.body.callbackURL)}`,
        );
      });
      (service.auth as unknown as { api: { signInMagicLink: typeof signInMagicLink } }).api.signInMagicLink =
        signInMagicLink;
      return signInMagicLink;
    }

    describe("describeInvitation", () => {
      it("summarises a pending portal invitation", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() => Promise.resolve(portalInvite));

        expect(await service.describeInvitation("inv-1")).toEqual({
          email: "jane@acme.com",
          organizationName: "Acme Agency",
          portal: true,
        });
      });

      it("marks a staff invitation as not a portal one", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() =>
          Promise.resolve({ ...portalInvite, role: "admin" }),
        );

        expect((await service.describeInvitation("inv-1"))?.portal).toBe(false);
      });

      it("returns null for an expired, used or unknown invitation", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() =>
          Promise.resolve({ ...portalInvite, expiresAt: new Date(Date.now() - 1000) }),
        );
        expect(await service.describeInvitation("inv-1")).toBeNull();

        mockPrisma.invitation.findUnique.mockImplementation(() =>
          Promise.resolve({ ...portalInvite, status: "accepted" }),
        );
        expect(await service.describeInvitation("inv-1")).toBeNull();

        mockPrisma.invitation.findUnique.mockImplementation(() => Promise.resolve(null));
        expect(await service.describeInvitation("nope")).toBeNull();
      });
    });

    describe("startInviteSignIn", () => {
      it("returns a sign-in URL without emailing when the invitee has no account yet", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() => Promise.resolve(portalInvite));
        mockPrisma.contact.findFirst.mockImplementation(() => Promise.resolve({ name: "Jane Doe" }));
        const signIn = stubSignInMagicLink();

        const result = await service.startInviteSignIn("inv-1");

        expect(result).toEqual({
          url: expect.stringContaining("http://localhost:3001/api/auth/magic-link/verify?token=tok-1"),
        });
        expect(mockMail.send).not.toHaveBeenCalled();
        const body = (signIn.mock.calls[0][0] as SignInCall).body;
        expect(body.email).toBe("jane@acme.com");
        expect(body.name).toBe("Jane Doe");
        expect(body.callbackURL).toBe("http://localhost:3000/accept-invite?id=inv-1");
      });

      it("names a new account after the email when the contact has no real name", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() => Promise.resolve(portalInvite));
        mockPrisma.contact.findFirst.mockImplementation(() => Promise.resolve({ name: "jane@acme.com" }));
        const signIn = stubSignInMagicLink();

        await service.startInviteSignIn("inv-1");

        expect((signIn.mock.calls[0][0] as SignInCall).body.name).toBe("jane");
      });

      it("emails a link instead when the invitee already has an account", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() => Promise.resolve(portalInvite));
        mockPrisma.user.findFirst.mockImplementation(() => Promise.resolve({ id: "u-1" }));
        stubSignInMagicLink();

        const result = await service.startInviteSignIn("inv-1");

        expect(result).toEqual({ emailed: true });
        expect(mockMail.send).toHaveBeenCalledTimes(1);
      });

      it("refuses a staff invitation, which keeps the password form", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() =>
          Promise.resolve({ ...portalInvite, role: "admin" }),
        );
        const signIn = stubSignInMagicLink();

        await expect(service.startInviteSignIn("inv-1")).rejects.toThrow(BadRequestException);
        expect(signIn).not.toHaveBeenCalled();
      });

      it("refuses an invitation that is no longer pending", async () => {
        mockPrisma.invitation.findUnique.mockImplementation(() =>
          Promise.resolve({ ...portalInvite, status: "canceled" }),
        );
        const signIn = stubSignInMagicLink();

        await expect(service.startInviteSignIn("inv-1")).rejects.toThrow(NotFoundException);
        expect(signIn).not.toHaveBeenCalled();
      });
    });

    describe("deliverMagicLink", () => {
      it("never emails an address with no account, so the login page cannot create one", async () => {
        await service.deliverMagicLink("stranger@example.com", "http://localhost:3001/api/auth/magic-link/verify?token=t");

        expect(mockMail.send).not.toHaveBeenCalled();
      });

      it("emails a link to the web app's confirm page rather than the API's verify endpoint", async () => {
        mockPrisma.user.findFirst.mockImplementation(() => Promise.resolve({ id: "u-1" }));

        await service.deliverMagicLink(
          "jane@acme.com",
          "http://localhost:3001/api/auth/magic-link/verify?token=t&callbackURL=%2Fportal",
        );

        expect(mockMail.send).toHaveBeenCalledTimes(1);
        const html = String((mockMail.send.mock.calls[0] as unknown[])[2]);
        expect(html).toContain("http://localhost:3000/magic-link?token=t&callbackURL=%2Fportal");
        expect(html).not.toContain("/api/auth/magic-link/verify");
      });

      it("stops emailing an address after 3 links in 15 minutes", async () => {
        mockPrisma.user.findFirst.mockImplementation(() => Promise.resolve({ id: "u-1" }));
        const verify = "http://localhost:3001/api/auth/magic-link/verify?token=t";

        for (let i = 0; i < 4; i++) await service.deliverMagicLink("Jane@acme.com", verify);
        await service.deliverMagicLink("other@acme.com", verify);

        expect(mockMail.send).toHaveBeenCalledTimes(4);
        expect((mockMail.send.mock.calls[3] as unknown[])[0]).toBe("other@acme.com");
      });

      describe("on a workspace's custom domain", () => {
        const verifyFrom = (origin: string): string =>
          `http://localhost:3001/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(`${origin}/portal`)}`;

        beforeEach(() => {
          mockPrisma.user.findFirst.mockImplementation(() => Promise.resolve({ id: "u-1" }));
          mockPrisma.organization.findUnique.mockImplementation(() => Promise.resolve({ id: "org-1" }));
        });

        it("opens the link on that domain for a member of the workspace", async () => {
          mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve({ id: "m-1" }));

          await service.deliverMagicLink("jane@acme.com", verifyFrom("https://portal.acme.com"));

          const html = String((mockMail.send.mock.calls[0] as unknown[])[2]);
          expect(html).toContain("https://portal.acme.com/magic-link?token=t");
        });

        it("uses the main site for someone outside that workspace", async () => {
          await service.deliverMagicLink("jane@acme.com", verifyFrom("https://portal.acme.com"));

          const html = String((mockMail.send.mock.calls[0] as unknown[])[2]);
          expect(html).toContain("http://localhost:3000/magic-link?token=t");
        });

        it("uses the main site when the workspace's plan no longer includes custom domains", async () => {
          mockPrisma.member.findFirst.mockImplementation(() => Promise.resolve({ id: "m-1" }));
          mockBilling.hasFeature.mockImplementation(() => Promise.resolve(false));

          await service.deliverMagicLink("jane@acme.com", verifyFrom("https://portal.acme.com"));

          const html = String((mockMail.send.mock.calls[0] as unknown[])[2]);
          expect(html).toContain("http://localhost:3000/magic-link?token=t");
        });
      });
    });

    describe("trustedOriginsFor", () => {
      const from = (host: string): Request =>
        new Request("http://internal/api/auth/sign-in/magic-link", { headers: { host } });

      it("trusts a workspace's custom domain when the request arrived on it", async () => {
        mockPrisma.organization.findUnique.mockImplementation(() => Promise.resolve({ id: "org-1" }));

        expect(await service.trustedOriginsFor(from("portal.acme.com:443"))).toContain("https://portal.acme.com");
      });

      it("trusts only the main origins for an unknown or unentitled host", async () => {
        expect(await service.trustedOriginsFor(from("evil.test"))).toEqual([
          "http://localhost:3000",
          "http://localhost:3001",
        ]);

        mockPrisma.organization.findUnique.mockImplementation(() => Promise.resolve({ id: "org-1" }));
        mockBilling.hasFeature.mockImplementation(() => Promise.resolve(false));
        expect(await service.trustedOriginsFor(from("portal.acme.com"))).not.toContain("https://portal.acme.com");
      });

      it("skips the lookup for the main site and server-side calls", async () => {
        await service.trustedOriginsFor(from("localhost:3000"));
        await service.trustedOriginsFor(undefined);

        expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
      });
    });

    describe("signInLinksAvailable", () => {
      it("is true when the server has a Resend key", async () => {
        resendApiKey = "re_123";
        expect(await service.signInLinksAvailable()).toBe(true);
      });

      it("is true when a workspace has set up its own email", async () => {
        mockPrisma.systemSettings.count.mockImplementation(() => Promise.resolve(1));
        expect(await service.signInLinksAvailable()).toBe(true);
      });

      it("is false when nothing can send email", async () => {
        expect(await service.signInLinksAvailable()).toBe(false);
      });
    });
  });

  describe("setPassword", () => {
    it("sets a first password through Better Auth with the caller's session", async () => {
      const setPassword = mock(() => Promise.resolve({ status: true }));
      (service.auth as unknown as { api: { setPassword: typeof setPassword } }).api.setPassword = setPassword;

      await service.setPassword({ cookie: "session=abc" }, "correct horse");

      const call = (setPassword.mock.calls[0] as unknown as [{ body: unknown; headers: Headers }])[0];
      expect(call.body).toEqual({ newPassword: "correct horse" });
      expect(call.headers.get("cookie")).toBe("session=abc");
    });

    it("turns Better Auth's refusal into a 400", async () => {
      (service.auth as unknown as { api: { setPassword: () => Promise<never> } }).api.setPassword = () =>
        Promise.reject(new APIError("BAD_REQUEST", { message: "Password already set" }));

      await expect(service.setPassword({}, "correct horse")).rejects.toThrow(BadRequestException);
    });
  });
});
