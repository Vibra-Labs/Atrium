import { describe, expect, it, mock } from "bun:test";
import { fakeEmailRenderer } from "../common/testing/fake-email-renderer";
import { WeeklyReminderTask } from "./weekly-reminder.task";

const NOW = new Date("2026-10-09T13:00:00Z");
const SIX_DAYS_AGO = new Date("2026-10-03T13:00:00Z");

const OWNER = {
  id: "m1",
  organizationId: "org1",
  user: { email: "jenn@studio.test" },
  organization: { name: "Klout Creative", systemSettings: { timezone: null } },
};

function inZone(timezone: string) {
  return { ...OWNER, organization: { ...OWNER.organization, systemSettings: { timezone } } };
}

function build(opts: { due?: unknown[]; claimCount?: number; sent?: boolean; members?: unknown[] } = {}) {
  const prisma = {
    member: {
      findMany: mock(() => Promise.resolve(opts.members ?? [OWNER])),
      updateMany: mock(() => Promise.resolve({ count: opts.claimCount ?? 1 })),
      update: mock(() => Promise.resolve({})),
    },
  };
  const weekly = {
    getDue: mock(() =>
      Promise.resolve(
        opts.due ?? [
          { projectId: "p1", projectName: "Living Unlimited", lastUpdateAt: new Date("2026-09-25T13:00:00Z"), clientCount: 1 },
          { projectId: "p2", projectName: "New Site", lastUpdateAt: null, clientCount: 2 },
        ],
      ),
    ),
  };
  const mail = { send: mock(() => Promise.resolve({ sent: opts.sent ?? true, viaOrgConfig: false })) };
  const config = { get: (k: string, fallback?: string) => (k === "WEB_URL" ? "https://app.atrium.test" : fallback) };
  const task = new WeeklyReminderTask(prisma as never, weekly as never, mail as never, config as never, fakeEmailRenderer());
  return { task, prisma, weekly, mail };
}

describe("WeeklyReminderTask", () => {
  it("only considers owners and admins who kept reminders on and weren't emailed this week", async () => {
    const { task, prisma } = build();
    await task.sendReminders(NOW);
    const call = prisma.member.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(call[0].where).toEqual({
      role: { in: ["owner", "admin"] },
      weeklyUpdateReminders: true,
      OR: [{ weeklyReminderSentAt: null }, { weeklyReminderSentAt: { lt: SIX_DAYS_AGO } }],
    });
  });

  it("emails the due projects with links to their drafts, through the workspace's mail settings", async () => {
    const { task, mail, prisma } = build();
    await task.sendReminders(NOW);

    expect(prisma.member.updateMany).toHaveBeenCalledWith({
      where: {
        id: "m1",
        OR: [{ weeklyReminderSentAt: null }, { weeklyReminderSentAt: { lt: SIX_DAYS_AGO } }],
      },
      data: { weeklyReminderSentAt: NOW },
    });
    const [to, subject, html, orgId] = mail.send.mock.calls[0] as unknown as [string, string, string, string];
    expect(to).toBe("jenn@studio.test");
    expect(subject).toBe("2 client projects need an update this week");
    expect(orgId).toBe("org1");
    expect(html).toContain("Living Unlimited");
    expect(html).toContain("Last update 14 days ago");
    expect(html).toContain("No updates yet");
    expect(html).toContain("https://app.atrium.test/dashboard/projects/p1?tab=updates&compose=weekly");
    expect(html).toContain("https://app.atrium.test/dashboard/settings/account#notifications");
  });

  it("skips people with nothing due", async () => {
    const { task, mail, prisma } = build({ due: [] });
    await task.sendReminders(NOW);
    expect(prisma.member.updateMany).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("looks up due projects once per workspace", async () => {
    const { task, weekly } = build({ members: [OWNER, { ...OWNER, id: "m2", user: { email: "admin@studio.test" } }] });
    await task.sendReminders(NOW);
    expect(weekly.getDue).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when another instance already claimed this week's reminder", async () => {
    const { task, mail } = build({ claimCount: 0 });
    await task.sendReminders(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("keeps the claim when the email could not be sent, so it does not retry every hour", async () => {
    const { task, prisma } = build({ sent: false });
    await task.sendReminders(NOW);
    expect(prisma.member.update).not.toHaveBeenCalled();
  });

  it("waits for Friday 13:00 in the workspace's own timezone", async () => {
    // 13:00 UTC on Friday is 06:00 in Los Angeles and already Saturday in Sydney.
    const la = build({ members: [inZone("America/Los_Angeles")] });
    await la.task.sendReminders(NOW);
    expect(la.mail.send).not.toHaveBeenCalled();

    const sydney = build({ members: [inZone("Australia/Sydney")] });
    await sydney.task.sendReminders(NOW);
    expect(sydney.mail.send).not.toHaveBeenCalled();

    const laLater = build({ members: [inZone("America/Los_Angeles")] });
    await laLater.task.sendReminders(new Date("2026-10-09T20:00:00Z"));
    expect(laLater.mail.send).toHaveBeenCalledTimes(1);
  });
});
