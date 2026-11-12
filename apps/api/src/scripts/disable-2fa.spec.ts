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
    });
  });
});

function deps(user: { id: string } | null) {
  const reset = mock((): Promise<{ hadTwoFactor: boolean }> => Promise.resolve({ hadTwoFactor: true }));
  const alert = mock((): Promise<void> => Promise.resolve());
  const log = mock(() => undefined);
  const print = mock(() => undefined);
  const d: RunDeps = {
    findUser: async (): Promise<{ id: string } | null> => user,
    reset,
    alert,
    log,
    print,
  };
  return { d, reset, alert, log };
}

describe("run", () => {
  it("exits 1 for an unknown email without touching anything", async () => {
    const { d, reset, alert } = deps(null);
    expect(await run(d, "nobody@example.com", "test")).toBe(1);
    expect(reset).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("resets, emails and logs for a known user", async () => {
    const { d, reset, alert, log } = deps({ id: "u1" });
    expect(await run(d, "Ada@Example.com", "ticket 42")).toBe(0);
    expect(reset).toHaveBeenCalledWith("u1");
    expect(alert).toHaveBeenCalledWith("u1");
    expect(log).toHaveBeenCalledWith({ event: "two_factor.reset_by_operator", userId: "u1", reason: "ticket 42" });
  });
});
