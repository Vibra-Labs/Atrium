import { describe, expect, it, mock } from "bun:test";
import { APIError } from "better-auth/api";
import { STEP_UP_ATTEMPTS, twoFactorAfterHook, twoFactorBeforeHook } from "./two-factor-hooks";
import type { AuthHookContext, PasswordCheck, TwoFactorHookDeps } from "./two-factor-hooks";
import { INTERNAL_CHECK_HEADER } from "./two-factor-hooks";

interface Fakes {
  deps: TwoFactorHookDeps;
  sessionUpdate: ReturnType<typeof mock>;
  sessionDelete: ReturnType<typeof mock>;
  forgetSession: ReturnType<typeof mock>;
  forgetUser: ReturnType<typeof mock>;
  sendAlert: ReturnType<typeof mock>;
  failures: Map<string, number>;
}

function fakes(): Fakes {
  const failures = new Map<string, number>();
  const sessionUpdate = mock(() => Promise.resolve({}));
  const sessionDelete = mock(() => Promise.resolve({}));
  const forgetSession = mock(() => undefined);
  const forgetUser = mock(() => undefined);
  const sendAlert = mock(() => Promise.resolve());
  const deps: TwoFactorHookDeps = {
    prisma: {
      session: { update: sessionUpdate, deleteMany: sessionDelete },
    } as unknown as TwoFactorHookDeps["prisma"],
    forgetSession,
    forgetUser,
    sendAlert,
    verifyOwnCode: mock(async (code: string): Promise<boolean> => code === "123456"),
    checkPassword: async (_userId: string, password: string | undefined): Promise<PasswordCheck> =>
      password === undefined ? "none" : password === "right" ? "ok" : "wrong",
    internalCheckToken: "secret-token",
    recoveryCodesLeft: async (): Promise<number> => 4,
    isStaffInRequiringWorkspace: async (userId: string): Promise<boolean> => userId.startsWith("staff"),
    factorsOf: async (userId: string): Promise<{ totp: boolean; passkeys: number }> => ({
      totp: true,
      passkeys: userId === "staff-with-passkey" || userId === "staff-lost-passkey" ? 1 : 0,
    }),
    claimTotpDisable: mock(async (userId: string): Promise<"ok" | "last_factor"> =>
      userId === "staff-lost-passkey" ? "last_factor" : "ok",
    ),
    releaseTotpDisable: mock(async (): Promise<void> => undefined),
    recordStepUpFailure: async (sessionId: string): Promise<number> => {
      const next: number = (failures.get(sessionId) ?? 0) + 1;
      failures.set(sessionId, next);
      return next;
    },
  };
  return { deps, sessionUpdate, sessionDelete, forgetSession, forgetUser, sendAlert, failures };
}

function ctx(
  path: string,
  returned: unknown,
  secondFactor: string | null = null,
  newSession = false,
  withSession = true,
  hasTotp = true,
): AuthHookContext {
  return {
    path,
    context: {
      returned,
      session: withSession
        ? { session: { id: "s1", token: "t1", secondFactor }, user: { id: "u1", twoFactorEnabled: hasTotp } }
        : null,
      newSession: newSession ? { session: { token: "t2" }, user: { id: "u1" } } : null,
    },
  };
}

describe("twoFactorAfterHook", () => {
  it("marks the existing session verified after a successful verify-totp", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-totp", { token: "t1" }), f.deps);
    expect(f.sessionUpdate).toHaveBeenCalledWith({ where: { token: "t1" }, data: { secondFactor: "totp" } });
    expect(f.forgetSession).toHaveBeenCalledWith("t1");
  });

  it("marks the existing session backup_code after a recovery code", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-backup-code", { token: "t1" }), f.deps);
    expect(f.sessionUpdate).toHaveBeenCalledWith({ where: { token: "t1" }, data: { secondFactor: "backup_code" } });
  });

  it("does not touch the session when the code was wrong", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-totp", new APIError("UNAUTHORIZED")), f.deps);
    expect(f.sessionUpdate).not.toHaveBeenCalled();
  });

  it("leaves a session the plugin just created to the create hook", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-totp", { token: "t2" }, null, true), f.deps);
    expect(f.sessionUpdate).not.toHaveBeenCalled();
  });

  it(`signs a pending session out after ${STEP_UP_ATTEMPTS} wrong codes`, async () => {
    const f = fakes();
    for (let i = 0; i < STEP_UP_ATTEMPTS - 1; i++) {
      await twoFactorAfterHook(ctx("/two-factor/verify-totp", new APIError("UNAUTHORIZED")), f.deps);
    }
    expect(f.sessionDelete).not.toHaveBeenCalled();
    await twoFactorAfterHook(ctx("/two-factor/verify-totp", new APIError("UNAUTHORIZED")), f.deps);
    expect(f.sessionDelete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(f.forgetSession).toHaveBeenCalledWith("t1");
  });

  it("does not count wrong codes while setting 2FA up", async () => {
    const f = fakes();
    for (let i = 0; i < STEP_UP_ATTEMPTS; i++) {
      await twoFactorAfterHook(ctx("/two-factor/verify-totp", new APIError("UNAUTHORIZED"), null, false, true, false), f.deps);
    }
    expect(f.failures.size).toBe(0);
    expect(f.sessionDelete).not.toHaveBeenCalled();
  });

  it("does not count wrong codes from an already verified session", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-totp", new APIError("UNAUTHORIZED"), "totp"), f.deps);
    expect(f.failures.size).toBe(0);
  });

  it("ignores other paths", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/sign-in/email", { token: "t1" }), f.deps);
    expect(f.sessionUpdate).not.toHaveBeenCalled();
  });
  it("drops every cached session of a user who just turned 2FA on", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-totp", { token: "t2" }, null, true), f.deps);
    expect(f.forgetUser).toHaveBeenCalledWith("u1");
  });
});

describe("twoFactorAfterHook alerts", () => {
  it("emails the user when a recovery code was used on the password challenge", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-backup-code", { token: "t2" }, null, true, false), f.deps);
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "recovery_code_used", remaining: 4 });
  });

  it("emails the user when a recovery code was used to step up", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-backup-code", { token: "t1" }), f.deps);
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "recovery_code_used", remaining: 4 });
  });

  it("does not email about a wrong recovery code", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/verify-backup-code", new APIError("UNAUTHORIZED")), f.deps);
    expect(f.sendAlert).not.toHaveBeenCalled();
  });

  it("stays quiet when Atrium checks a code itself to confirm an action", async () => {
    const f = fakes();
    const internal: AuthHookContext = {
      ...ctx("/two-factor/verify-backup-code", { status: true }, "totp"),
      headers: new Headers({ [INTERNAL_CHECK_HEADER]: "secret-token" }),
    };
    await twoFactorAfterHook(internal, f.deps);
    expect(f.sendAlert).not.toHaveBeenCalled();
    expect(f.sessionUpdate).not.toHaveBeenCalled();
  });

  it("still alerts when the marker header doesn't carry the secret", async () => {
    const f = fakes();
    const forged: AuthHookContext = {
      ...ctx("/two-factor/verify-backup-code", { status: true }, "totp"),
      headers: new Headers({ [INTERNAL_CHECK_HEADER]: "guess" }),
    };
    await twoFactorAfterHook(forged, f.deps);
    expect(f.sendAlert).toHaveBeenCalled();
  });

  it("emails the user when they change their password while signed in", async () => {
    const f = fakes();
    const change: AuthHookContext = { ...ctx("/change-password", { token: null }), body: { revokeOtherSessions: true } };
    await twoFactorAfterHook(change, f.deps);
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "password_changed", signedOut: true });
  });

  it("doesn't email about a password change that failed", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/change-password", new APIError("BAD_REQUEST")), f.deps);
    expect(f.sendAlert).not.toHaveBeenCalled();
  });

  it("clears the turn-off mark whether turning off worked or not", async () => {
    const ok = fakes();
    await twoFactorAfterHook(ctx("/two-factor/disable", { status: true }, "totp", true), ok.deps);
    expect(ok.deps.releaseTotpDisable).toHaveBeenCalledWith("u1");
    const failed = fakes();
    await twoFactorAfterHook(ctx("/two-factor/disable", new APIError("BAD_REQUEST")), failed.deps);
    expect(failed.deps.releaseTotpDisable).toHaveBeenCalledWith("u1");
  });

  it("emails the user and drops their cached sessions when they turn 2FA off", async () => {
    const f = fakes();
    await twoFactorAfterHook(ctx("/two-factor/disable", { status: true }, "totp", true), f.deps);
    expect(f.sendAlert).toHaveBeenCalledWith("u1", { kind: "two_factor_disabled", by: "you", passkeys: false });
    expect(f.forgetUser).toHaveBeenCalledWith("u1");
  });
});

describe("twoFactorBeforeHook", () => {
  const base = { userId: "client", twoFactorEnabled: true, code: "123456", password: undefined, headers: new Headers() };

  it("checks the password before the code, so a wrong password never uses up a recovery code", async () => {
    const f = fakes();
    const err: unknown = await twoFactorBeforeHook(
      { ...base, path: "/two-factor/disable", code: "abcde-12345", password: "wrong" },
      f.deps,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).body?.code).toBe("INVALID_PASSWORD");
    expect(f.deps.verifyOwnCode).not.toHaveBeenCalled();
  });

  it("goes on to the code once the password is right", async () => {
    const f = fakes();
    await twoFactorBeforeHook({ ...base, path: "/two-factor/disable", password: "right" }, f.deps);
    expect(f.deps.verifyOwnCode).toHaveBeenCalled();
  });

  it("refuses to turn off the only factor of staff in a requiring workspace", async () => {
    const f = fakes();
    await expect(
      twoFactorBeforeHook({ ...base, path: "/two-factor/disable", userId: "staff" }, f.deps),
    ).rejects.toThrow(APIError);
  });

  it("lets staff of a requiring workspace turn TOTP off when they have a passkey", async () => {
    const f = fakes();
    await twoFactorBeforeHook({ ...base, path: "/two-factor/disable", userId: "staff-with-passkey" }, f.deps);
  });

  it("claims the turn-off under the passkey lock after the code, for staff of a requiring workspace", async () => {
    const f = fakes();
    await twoFactorBeforeHook({ ...base, path: "/two-factor/disable", userId: "staff-with-passkey" }, f.deps);
    expect(f.deps.claimTotpDisable).toHaveBeenCalledWith("staff-with-passkey");
  });

  it("refuses when the last passkey went away while the code was checked", async () => {
    const f = fakes();
    await expect(
      twoFactorBeforeHook({ ...base, path: "/two-factor/disable", userId: "staff-lost-passkey" }, f.deps),
    ).rejects.toThrow("Your workspace requires two-factor authentication");
  });

  it("doesn't claim anything for users nothing requires 2FA of", async () => {
    const f = fakes();
    await twoFactorBeforeHook({ ...base, path: "/two-factor/disable" }, f.deps);
    expect(f.deps.claimTotpDisable).not.toHaveBeenCalled();
  });

  it("lets anyone else turn 2FA off with a current code", async () => {
    const f = fakes();
    await twoFactorBeforeHook({ ...base, path: "/two-factor/disable" }, f.deps);
  });

  it("needs a current code to turn 2FA off", async () => {
    const f = fakes();
    await expect(twoFactorBeforeHook({ ...base, path: "/two-factor/disable", code: undefined }, f.deps)).rejects.toThrow(
      "Enter a code from your authenticator app, or a recovery code.",
    );
    await expect(twoFactorBeforeHook({ ...base, path: "/two-factor/disable", code: "000000" }, f.deps)).rejects.toThrow(
      APIError,
    );
  });

  it("needs a current code to make new recovery codes", async () => {
    const f = fakes();
    await expect(
      twoFactorBeforeHook({ ...base, path: "/two-factor/generate-backup-codes", code: "000000" }, f.deps),
    ).rejects.toThrow(APIError);
    await twoFactorBeforeHook({ ...base, path: "/two-factor/generate-backup-codes" }, f.deps);
  });

  it("never hands out the authenticator secret once 2FA is on", async () => {
    const f = fakes();
    await expect(twoFactorBeforeHook({ ...base, path: "/two-factor/get-totp-uri" }, f.deps)).rejects.toThrow(APIError);
    await twoFactorBeforeHook({ ...base, path: "/two-factor/get-totp-uri", twoFactorEnabled: false }, f.deps);
  });

  it("refuses to 'turn off' two-factor that isn't on", async () => {
    const f = fakes();
    await expect(
      twoFactorBeforeHook({ ...base, path: "/two-factor/disable", twoFactorEnabled: false, code: undefined }, f.deps),
    ).rejects.toThrow("The authenticator app isn't turned on.");
  });

  it("ignores other paths", async () => {
    const f = fakes();
    await twoFactorBeforeHook({ ...base, path: "/two-factor/enable", userId: "staff", code: undefined }, f.deps);
  });
});
