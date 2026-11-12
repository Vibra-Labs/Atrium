import { describe, expect, it, mock } from "bun:test";
import { parseArgs, run } from "./disable-2fa-core";
import type { RunDeps } from "./disable-2fa-core";

describe("parseArgs", () => {
  it("needs a reason", () => {
    expect(parseArgs(["ada@example.com"])).toEqual({ error: expect.stringContaining("--reason") });
  });

  it("needs an email", () => {
    expect(parseArgs(["--reason", "ticket 42"])).toEqual({ error: expect.stringContaining("email") });
  });

  it("reads the email and the reason", () => {
    expect(parseArgs(["ada@example.com", "--reason", "ticket 42"])).toEqual({
      email: "ada@example.com",
      reason: "ticket 42",
      passkeys: false,
    });
  });

  it("reads --passkeys", () => {
    expect(parseArgs(["ada@example.com", "--reason", "t", "--passkeys"])).toEqual({
      email: "ada@example.com",
      reason: "t",
      passkeys: true,
    });
  });
});

function deps(user: { id: string } | null, passkeysLeft = 0) {
  const reset = mock(
    (): Promise<{ hadTwoFactor: boolean; passkeysRemoved: number; passkeysLeft: number }> =>
      Promise.resolve({ hadTwoFactor: true, passkeysRemoved: 0, passkeysLeft }),
  );
  const alert = mock((): Promise<void> => Promise.resolve());
  const log = mock(() => undefined);
  const print = mock((_text: string) => undefined);
  const d: RunDeps = {
    findUser: async (): Promise<{ id: string } | null> => user,
    reset,
    alert,
    log,
    print,
  };
  return { d, reset, alert, log, print };
}

describe("run", () => {
  it("exits 1 for an unknown email without touching anything", async () => {
    const { d, reset, alert } = deps(null);
    expect(await run(d, "nobody@example.com", "test", false)).toBe(1);
    expect(reset).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("resets, emails and logs for a known user", async () => {
    const { d, reset, alert, log } = deps({ id: "u1" });
    expect(await run(d, "Ada@Example.com", "ticket 42", false)).toBe(0);
    expect(reset).toHaveBeenCalledWith("u1", false);
    expect(alert).toHaveBeenCalledWith("u1", false);
    expect(log).toHaveBeenCalledWith({ event: "two_factor.reset_by_operator", userId: "u1", reason: "ticket 42" });
  });
  it("passes --passkeys on, and says when passkeys were left", async () => {
    const { d, reset, alert, print } = deps({ id: "u1" }, 2);
    await run(d, "ada@example.com", "t", false);
    expect(print.mock.calls.map((c) => c[0]).join("\n")).toContain(
      "They still have 2 passkeys; run again with --passkeys to remove them.",
    );
    await run(d, "ada@example.com", "t", true);
    expect(reset).toHaveBeenLastCalledWith("u1", true);
    expect(alert).toHaveBeenLastCalledWith("u1", true);
  });
});
