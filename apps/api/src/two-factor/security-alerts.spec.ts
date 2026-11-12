import { describe, expect, it, mock } from "bun:test";
import { fakeEmailRenderer } from "../common/testing/fake-email-renderer";
import type { Logger } from "@nestjs/common";
import { sendSecurityAlert } from "./security-alerts";
import type { SecurityAlertDeps } from "./security-alerts";

function deps(sendImpl?: () => Promise<unknown>) {
  const send = mock(sendImpl ?? ((): Promise<unknown> => Promise.resolve({ sent: true, viaOrgConfig: false })));
  const error = mock(() => undefined);
  const d: SecurityAlertDeps = {
    prisma: {
      user: { findUnique: mock(() => Promise.resolve({ email: "ada@example.com" })) },
      member: { findFirst: mock(() => Promise.resolve({ organizationId: "org1" })) },
    } as unknown as SecurityAlertDeps["prisma"],
    mail: { send } as unknown as SecurityAlertDeps["mail"],
    renderer: fakeEmailRenderer(),
    logger: { error, log: mock(() => undefined) } as unknown as Logger,
  };
  return { d, send, error };
}

describe("sendSecurityAlert", () => {
  it("tells the user 2FA was turned off, and by whom", async () => {
    const { d, send } = deps();
    await sendSecurityAlert(d, "u1", { kind: "two_factor_disabled", by: "admin" });
    const [to, subject, html, org] = send.mock.calls[0] as unknown as [string, string, string, string];
    expect(to).toBe("ada@example.com");
    expect(subject).toBe("Two-factor authentication was turned off");
    expect(html).toContain("A workspace owner or admin");
    expect(org).toBe("org1");
  });

  it("says how many recovery codes are left, and nudges at 3 or fewer", async () => {
    const { d, send } = deps();
    await sendSecurityAlert(d, "u1", { kind: "recovery_code_used", remaining: 2 });
    const [, subject, html] = send.mock.calls[0] as unknown as [string, string, string];
    expect(subject).toBe("A recovery code was used to sign in");
    expect(html).toContain("2 recovery codes left");
    expect(html).toContain("Settings");
  });

  it("tells the user their password changed", async () => {
    const { d, send } = deps();
    await sendSecurityAlert(d, "u1", { kind: "password_changed" });
    expect((send.mock.calls[0] as unknown as [string, string])[1]).toBe("Your password was changed");
  });

  it("logs a failed send instead of throwing", async () => {
    const { d, error } = deps(() => Promise.reject(new Error("smtp down")));
    await sendSecurityAlert(d, "u1", { kind: "password_changed" });
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("sendSecurityAlert for passkeys", () => {
  it("tells the user a passkey was added", async () => {
    const { d, send } = deps();
    await sendSecurityAlert(d, "u1", { kind: "passkey_added" });
    expect((send.mock.calls[0] as unknown as [string, string])[1]).toBe("A passkey was added to your account");
  });

  it("tells the user a passkey was removed", async () => {
    const { d, send } = deps();
    await sendSecurityAlert(d, "u1", { kind: "passkey_removed" });
    expect((send.mock.calls[0] as unknown as [string, string])[1]).toBe("A passkey was removed from your account");
  });
});
