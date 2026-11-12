import { describe, expect, it, mock } from "bun:test";
import { APIError } from "better-auth/api";
import { passkeyAfterHook, passkeyBeforeHook } from "./passkey-hooks";
import type { PasskeyAfterInput, PasskeyBeforeInput, PasskeyHookDeps } from "./passkey-hooks";

function fakes(opts: { staff?: boolean; requiring?: boolean; deleteOutcome?: "deleted" | "not_found" | "last_factor" } = {}) {
  const sessionUpdate = mock(() => Promise.resolve({}));
  const sessionDelete = mock(() => Promise.resolve({ count: 1 }));
  const sessionFind = mock((): Promise<unknown> => Promise.resolve({ userId: "u1", activeOrganizationId: "orgB" }));
  const forgetSession = mock(() => undefined);
  const forgetUser = mock(() => undefined);
  const sendAlert = mock(() => Promise.resolve());
  const deps: PasskeyHookDeps = {
    prisma: {
      session: { update: sessionUpdate, deleteMany: sessionDelete, findUnique: sessionFind },
    } as unknown as PasskeyHookDeps["prisma"],
    forgetSession,
    forgetUser,
    sendAlert,
    isStaffAnywhere: async (): Promise<boolean> => opts.staff ?? true,
    isStaffInRequiringWorkspace: async (): Promise<boolean> => opts.requiring ?? false,
    deletePasskey: async (): Promise<"deleted" | "not_found" | "last_factor"> => opts.deleteOutcome ?? "deleted",
  };
  return { deps, sessionUpdate, sessionDelete, sessionFind, forgetSession, forgetUser, sendAlert };
}

function before(overrides: Partial<PasskeyBeforeInput>): PasskeyBeforeInput {
  return { path: "/passkey/generate-register-options", userId: "u1", body: {}, ...overrides };
}

function after(overrides: Partial<PasskeyAfterInput>): PasskeyAfterInput {
  return {
    path: "/passkey/verify-authentication",
    ok: true,
    userId: "u1",
    currentSession: null,
    previousToken: null,
    newSessionToken: "new",
    ...overrides,
  };
}

describe("passkeyBeforeHook", () => {
  it("refuses registration to someone who is not staff anywhere", async () => {
    const f = fakes({ staff: false });
    for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration"]) {
      await expect(passkeyBeforeHook(before({ path }), f.deps)).rejects.toThrow(
        "Passkeys are for workspace owners and admins.",
      );
    }
  });

  it("lets staff register", async () => {
    await passkeyBeforeHook(before({}), fakes().deps);
  });

  it("refuses registration that would also sign in", async () => {
    await expect(
      passkeyBeforeHook(before({ path: "/passkey/verify-registration", body: { createSession: true } }), fakes().deps),
    ).rejects.toThrow(APIError);
  });

  it("caps passkey names at 64 characters", async () => {
    const long: string = "x".repeat(65);
    for (const path of ["/passkey/verify-registration", "/passkey/update-passkey"]) {
      await expect(passkeyBeforeHook(before({ path, body: { name: long } }), fakes().deps)).rejects.toThrow(APIError);
    }
    await passkeyBeforeHook(before({ path: "/passkey/update-passkey", body: { name: "x".repeat(64) } }), fakes().deps);
  });

  it("removes a passkey itself, inside one locked transaction, and answers the request", async () => {
    const f = fakes();
    const result = await passkeyBeforeHook(before({ path: "/passkey/delete-passkey", body: { id: "pk1" } }), f.deps);
    expect(result).toEqual({ status: true });
    expect(f.forgetUser).toHaveBeenCalledWith("u1");
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "passkey_removed" });
  });

  it("refuses removing the last factor of staff in a requiring workspace", async () => {
    const f = fakes({ deleteOutcome: "last_factor" });
    await expect(
      passkeyBeforeHook(before({ path: "/passkey/delete-passkey", body: { id: "pk1" } }), f.deps),
    ).rejects.toThrow("you can't remove your last way to provide it");
    expect(f.sendAlert).not.toHaveBeenCalled();
  });

  it("treats someone else's passkey as unauthorized", async () => {
    const f = fakes({ deleteOutcome: "not_found" });
    await expect(
      passkeyBeforeHook(before({ path: "/passkey/delete-passkey", body: { id: "pk1" } }), f.deps),
    ).rejects.toThrow(APIError);
  });
});

describe("passkeyAfterHook", () => {
  it("records when the passkey ceremony happened on the new session", async () => {
    const f = fakes();
    await passkeyAfterHook(after({ previousToken: null }), f.deps);
    const call = (f.sessionUpdate.mock.calls[0] as unknown as [{ where: unknown; data: Record<string, unknown> }])[0];
    expect(call.where).toEqual({ token: "new" });
    expect(call.data.passkeyVerifiedAt).toBeInstanceOf(Date);
  });

  it("keeps the workspace the replaced session was working in, for the same user", async () => {
    const f = fakes();
    await passkeyAfterHook(after({ previousToken: "old" }), f.deps);
    const data = (f.sessionUpdate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.activeOrganizationId).toBe("orgB");
  });

  it("does not carry another user's workspace", async () => {
    const f = fakes();
    f.sessionFind.mockImplementation(() => Promise.resolve({ userId: "someone-else", activeOrganizationId: "orgX" }));
    await passkeyAfterHook(after({ previousToken: "old" }), f.deps);
    const data = (f.sessionUpdate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.activeOrganizationId).toBeUndefined();
  });

  it("deletes the old session a passkey sign-in replaced", async () => {
    const f = fakes();
    await passkeyAfterHook(after({ previousToken: "old" }), f.deps);
    expect(f.sessionDelete).toHaveBeenCalledWith({ where: { token: "old" } });
    expect(f.forgetSession).toHaveBeenCalledWith("old");
  });

  it("leaves things alone when there was no other session, or the sign-in failed", async () => {
    const f = fakes();
    await passkeyAfterHook(after({ previousToken: null }), f.deps);
    await passkeyAfterHook(after({ previousToken: "new" }), f.deps);
    await passkeyAfterHook(after({ previousToken: "old", ok: false }), f.deps);
    expect(f.sessionDelete).not.toHaveBeenCalled();
  });

  it("marks the session that just registered a passkey as verified, and emails the user", async () => {
    const f = fakes();
    await passkeyAfterHook(
      after({ path: "/passkey/verify-registration", currentSession: { token: "t1", secondFactor: null }, newSessionToken: null }),
      f.deps,
    );
    expect(f.sessionUpdate).toHaveBeenCalledWith({ where: { token: "t1" }, data: { secondFactor: "passkey" } });
    expect(f.forgetUser).toHaveBeenCalledWith("u1");
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "passkey_added" });
  });

  it("keeps an already verified session's factor", async () => {
    const f = fakes();
    await passkeyAfterHook(
      after({ path: "/passkey/verify-registration", currentSession: { token: "t1", secondFactor: "totp" }, newSessionToken: null }),
      f.deps,
    );
    expect(f.sessionUpdate).not.toHaveBeenCalled();
  });

});
