import { describe, expect, it, mock } from "bun:test";
import { fakeEmailRenderer } from "../common/testing/fake-email-renderer";
import { InvitationReminderTask } from "./invitation-reminder.task";
import { INVITATION_EXPIRES_IN_SECONDS, REMINDER_AFTER_DAYS } from "./invitations";

const NOW = new Date("2026-10-14T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

interface DueRow {
  id: string;
  email: string;
  organizationId: string;
  inviterId: string;
  expiresAt: Date;
  organization: { name: string };
}

function due(overrides: Partial<DueRow> = {}): DueRow {
  return {
    id: "inv1",
    email: "client@acme.test",
    organizationId: "org1",
    inviterId: "owner1",
    expiresAt: new Date(NOW.getTime() + 10 * DAY_MS),
    organization: { name: "Acme Studio" },
    ...overrides,
  };
}

function build(
  opts: { rows?: DueRow[]; claimCount?: number; sendFails?: boolean; inviterName?: string | null; isMember?: boolean } = {},
) {
  const prisma = {
    invitation: {
      findMany: mock(() => Promise.resolve(opts.rows ?? [])),
      updateMany: mock(() => Promise.resolve({ count: opts.claimCount ?? 1 })),
    },
    member: {
      findFirst: mock(() => Promise.resolve(opts.isMember ? { id: "m1" } : null)),
    },
    user: {
      findUnique: mock(() =>
        Promise.resolve(opts.inviterName === null ? null : { name: opts.inviterName ?? "Edgar" }),
      ),
    },
  };
  const mail = {
    send: mock(() =>
      opts.sendFails ? Promise.reject(new Error("smtp down")) : Promise.resolve({ sent: true, viaOrgConfig: false }),
    ),
  };
  const values: Record<string, string> = { WEB_URL: "https://app.atrium.test" };
  const config = { get: (k: string, fallback?: string) => values[k] ?? fallback };
  const task = new InvitationReminderTask(prisma as never, mail as never, config as never, fakeEmailRenderer());
  return { task, prisma, mail };
}

describe("InvitationReminderTask", () => {
  it("looks for live pending invites older than the reminder delay that were never reminded", async () => {
    const { task, prisma } = build();
    await task.sendReminders(NOW);
    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "pending",
          reminderSentAt: null,
          createdAt: { lte: new Date(NOW.getTime() - REMINDER_AFTER_DAYS * DAY_MS) },
          expiresAt: {
            gt: NOW,
            lte: new Date(NOW.getTime() + INVITATION_EXPIRES_IN_SECONDS * 1000 - REMINDER_AFTER_DAYS * DAY_MS),
          },
        },
      }),
    );
  });

  it("claims the invite, then emails the invitee through the workspace's mail settings", async () => {
    const { task, prisma, mail } = build({ rows: [due()] });
    await task.sendReminders(NOW);
    expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: "inv1", reminderSentAt: null },
      data: { reminderSentAt: NOW },
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const [to, subject, html, orgId] = mail.send.mock.calls[0] as unknown as [string, string, string, string];
    expect(to).toBe("client@acme.test");
    expect(subject).toBe("Reminder: you're invited to Acme Studio");
    expect(orgId).toBe("org1");
    expect(html).toContain("https://app.atrium.test/accept-invite?id=inv1");
    expect(html).toContain("Edgar");
  });

  it("sends nothing when another instance already claimed the reminder", async () => {
    const { task, mail } = build({ rows: [due()], claimCount: 0 });
    await task.sendReminders(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("skips someone who is already a member of the workspace", async () => {
    const { task, mail } = build({ rows: [due()], isMember: true });
    await task.sendReminders(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("still reminds when the inviter's account is gone", async () => {
    const { task, mail } = build({ rows: [due()], inviterName: null });
    await task.sendReminders(NOW);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it("keeps going after one invite fails to send", async () => {
    const { task, mail } = build({ rows: [due({ id: "a" }), due({ id: "b" })], sendFails: true });
    await task.sendReminders(NOW);
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it("run() never throws, so one bad hour does not kill the scheduler", async () => {
    const { task, prisma } = build();
    prisma.invitation.findMany.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    await expect(task.run()).resolves.toBeUndefined();
  });
});
