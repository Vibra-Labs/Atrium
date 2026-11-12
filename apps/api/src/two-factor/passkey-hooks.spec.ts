import { describe, expect, it, mock } from "bun:test";
import { APIError } from "better-auth/api";
import { passkeyAfterHook, passkeyBeforeHook } from "./passkey-hooks";
import type { PasskeyAfterInput, PasskeyBeforeInput, PasskeyHookDeps } from "./passkey-hooks";

function fakes(opts: { staff?: boolean; requiring?: boolean } = {}) {
  const sessionUpdate = mock(() => Promise.resolve({}));
  const sessionDelete = mock(() => Promise.resolve({ count: 1 }));
  const forgetSession = mock(() => undefined);
  const forgetUser = mock(() => undefined);
  const sendAlert = mock(() => Promise.resolve());
  const deps: PasskeyHookDeps = {
    prisma: { session: { update: sessionUpdate, deleteMany: sessionDelete } } as unknown as PasskeyHookDeps["prisma"],
    forgetSession,
    forgetUser,
    sendAlert,
    isStaffAnywhere: async (): Promise<boolean> => opts.staff ?? true,
    isStaffInRequiringWorkspace: async (): Promise<boolean> => opts.requiring ?? false,
  };
  return { deps, sessionUpdate, sessionDelete, forgetSession, forgetUser, sendAlert };
}

function before(overrides: Partial<PasskeyBeforeInput>): PasskeyBeforeInput {
  return { path: "/passkey/generate-register-options", userId: "u1", twoFactorEnabled: false, passkeyCount: 0, body: {}, ...overrides };
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

  it("refuses removing the last factor of staff in a requiring workspace", async () => {
    await expect(
      passkeyBeforeHook(before({ path: "/passkey/delete-passkey", passkeyCount: 1 }), fakes({ requiring: true }).deps),
    ).rejects.toThrow("you can't remove your last way to provide it");
  });

  it("allows removing a passkey when another factor remains, or nothing requires one", async () => {
    await passkeyBeforeHook(before({ path: "/passkey/delete-passkey", passkeyCount: 2 }), fakes({ requiring: true }).deps);
    await passkeyBeforeHook(
      before({ path: "/passkey/delete-passkey", passkeyCount: 1, twoFactorEnabled: true }),
      fakes({ requiring: true }).deps,
    );
    await passkeyBeforeHook(before({ path: "/passkey/delete-passkey", passkeyCount: 1 }), fakes({ requiring: false }).deps);
  });

  it("asks for no proof to remove a passkey", async () => {
    await passkeyBeforeHook(before({ path: "/passkey/delete-passkey", passkeyCount: 2, body: {} }), fakes().deps);
  });
});

describe("passkeyAfterHook", () => {
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

  it("emails the user when a passkey is removed", async () => {
    const f = fakes();
    await passkeyAfterHook(after({ path: "/passkey/delete-passkey", newSessionToken: null }), f.deps);
    expect(f.forgetUser).toHaveBeenCalledWith("u1");
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "passkey_removed" });
  });
});
