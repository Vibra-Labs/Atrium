import { describe, expect, it, mock } from "bun:test";
import "../common/testing/mock-email";
import { TrialEmailsTask } from "./trial-emails.task";

const NOW = new Date("2026-10-08T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

interface SubRow {
  id: string;
  organizationId: string;
  currentPeriodEnd: Date | null;
  organization: { name: string };
  plan: { slug: string };
}

function row(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id: "sub1",
    organizationId: "org1",
    currentPeriodEnd: new Date(NOW.getTime() + 2.5 * DAY_MS),
    organization: { name: "Acme Studio" },
    plan: { slug: "free" },
    ...overrides,
  };
}

function build(opts: {
  billing?: string;
  reminders?: SubRow[];
  expired?: { organizationId: string }[];
  ended?: SubRow[];
  claimCount?: number;
  sent?: boolean;
} = {}) {
  const prisma = {
    subscription: {
      findMany: mock(({ where }: { where: Record<string, unknown> }) => {
        if ("trialReminderSentAt" in where) return Promise.resolve(opts.reminders ?? []);
        if ("trialEndedEmailSentAt" in where) return Promise.resolve(opts.ended ?? []);
        return Promise.resolve(opts.expired ?? []);
      }),
      updateMany: mock(() => Promise.resolve({ count: opts.claimCount ?? 1 })),
      update: mock(() => Promise.resolve({})),
    },
    member: {
      findMany: mock(() =>
        Promise.resolve([{ user: { email: "owner@acme.test" } }, { user: { email: "cofounder@acme.test" } }]),
      ),
    },
  };
  const billing = { getSubscription: mock(() => Promise.resolve(null)) };
  const mail = { send: mock(() => Promise.resolve({ sent: opts.sent ?? true, viaOrgConfig: false })) };
  const values: Record<string, string> = { BILLING_ENABLED: opts.billing ?? "true", WEB_URL: "https://app.atrium.test" };
  const config = { get: (k: string, fallback?: string) => values[k] ?? fallback };
  const task = new TrialEmailsTask(prisma as never, billing as never, mail as never, config as never);
  return { task, prisma, billing, mail };
}

describe("TrialEmailsTask", () => {
  it("does nothing when billing is off", async () => {
    const { task, prisma } = build({ billing: "false" });
    await task.run();
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
  });

  describe("ending reminders", () => {
    it("emails every owner once the trial is within 3 days of ending", async () => {
      const { task, mail, prisma } = build({ reminders: [row()] });
      await task.sendEndingReminders(NOW);
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: "sub1", trialReminderSentAt: null },
        data: { trialReminderSentAt: NOW },
      });
      expect(mail.send).toHaveBeenCalledTimes(2);
      const [to, subject, html] = mail.send.mock.calls[0] as unknown as [string, string, string];
      expect(to).toBe("owner@acme.test");
      expect(subject).toBe("Your Atrium Pro trial ends in 3 days");
      expect(html).toContain("Acme Studio");
      expect(html).toContain("https://app.atrium.test/dashboard/settings/billing");
    });

    it("sends nothing when another instance already claimed the reminder", async () => {
      const { task, mail } = build({ reminders: [row()], claimCount: 0 });
      await task.sendEndingReminders(NOW);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("releases the claim so it retries when no email could be sent", async () => {
      const { task, prisma } = build({ reminders: [row()], sent: false });
      await task.sendEndingReminders(NOW);
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: "sub1" },
        data: { trialReminderSentAt: null },
      });
    });
  });

  describe("ended notices", () => {
    it("downgrades trials nobody has opened since they ended", async () => {
      const { task, billing } = build({ expired: [{ organizationId: "org9" }] });
      await task.sendEndedNotices(NOW);
      expect(billing.getSubscription).toHaveBeenCalledWith("org9");
    });

    it("tells owners the trial has ended", async () => {
      const { task, mail } = build({ ended: [row({ currentPeriodEnd: null })] });
      await task.sendEndedNotices(NOW);
      expect(mail.send).toHaveBeenCalledTimes(2);
      const [, subject] = mail.send.mock.calls[0] as unknown as [string, string];
      expect(subject).toBe("Your Atrium Pro trial has ended");
    });

    it("skips the email when the workspace has since upgraded", async () => {
      const { task, mail, prisma } = build({ ended: [row({ plan: { slug: "pro" } })] });
      await task.sendEndedNotices(NOW);
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.subscription.updateMany).toHaveBeenCalled();
    });
  });
});
