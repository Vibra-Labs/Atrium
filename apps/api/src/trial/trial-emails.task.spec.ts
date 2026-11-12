import { describe, expect, it, mock } from "bun:test";
import { fakeEmailRenderer } from "../common/testing/fake-email-renderer";
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
  seatsRemaining?: number | null;
  lifetimeActive?: boolean;
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
      count: mock(() => Promise.resolve(3)),
    },
    project: { count: mock(() => Promise.resolve(2)) },
    projectUpdate: { count: mock(() => Promise.resolve(4)) },
    subscriptionPlan: {
      findUnique: mock(() => Promise.resolve({ maxSeats: 100, isActive: opts.lifetimeActive ?? true })),
    },
  };
  const billing = {
    getSubscription: mock(() => Promise.resolve(null)),
    getLifetimeSeatsRemaining: mock(() => Promise.resolve(opts.seatsRemaining === undefined ? 100 : opts.seatsRemaining)),
  };
  const mail = { send: mock(() => Promise.resolve({ sent: opts.sent ?? true, viaOrgConfig: false })) };
  const values: Record<string, string> = { BILLING_ENABLED: opts.billing ?? "true", WEB_URL: "https://app.atrium.test" };
  const config = { get: (k: string, fallback?: string) => values[k] ?? fallback };
  const task = new TrialEmailsTask(prisma as never, billing as never, mail as never, config as never, fakeEmailRenderer());
  const logger = { error: mock(() => {}), warn: mock(() => {}), log: mock(() => {}) };
  (task as unknown as { logger: typeof logger }).logger = logger;
  return { task, prisma, billing, mail, logger };
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

    it("keeps the claim when no email could be sent, so it does not retry every hour", async () => {
      const { task, prisma } = build({ reminders: [row()], sent: false });
      await task.sendEndingReminders(NOW);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it("carries on with the next workspace when one fails", async () => {
      const { task, mail, prisma } = build({ reminders: [row(), row({ id: "sub2", organizationId: "org2" })] });
      prisma.subscription.updateMany.mockImplementationOnce(() => Promise.reject(new Error("db down")));
      await task.sendEndingReminders(NOW);
      expect(mail.send).toHaveBeenCalledTimes(2); // org2's two owners
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

    it("carries on with the next workspace when one fails", async () => {
      const { task, mail, prisma } = build({ ended: [row(), row({ id: "sub2", organizationId: "org2" })] });
      prisma.subscription.updateMany.mockImplementationOnce(() => Promise.reject(new Error("db down")));
      await task.sendEndedNotices(NOW);
      expect(mail.send).toHaveBeenCalledTimes(2);
    });

    it("skips the email when the workspace has since upgraded", async () => {
      const { task, mail, prisma } = build({ ended: [row({ plan: { slug: "pro" } })] });
      await task.sendEndedNotices(NOW);
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.subscription.updateMany).toHaveBeenCalled();
    });
  });
  describe("what the emails say", () => {
    it("the reminder names what the workspace did and links to Pro and Lifetime", async () => {
      const { task, mail } = build({ reminders: [row()] });
      await task.sendEndingReminders(NOW);
      const [, , html] = mail.send.mock.calls[0] as unknown as [string, string, string];
      expect(html).toContain("So far Acme Studio has 2 projects shared with clients, 3 clients in the portal and 4 updates posted.");
      expect(html).toContain("https://app.atrium.test/dashboard/settings/billing?plan=pro&from=trial_email_ending");
      expect(html).toContain("https://app.atrium.test/dashboard/settings/billing?plan=lifetime&from=trial_email_ending");
      expect(html).toContain("Limited to 100 seats");
    });

    it("the ended notice links back with its own source", async () => {
      const { task, mail } = build({ ended: [row({ currentPeriodEnd: null })] });
      await task.sendEndedNotices(NOW);
      const [, , html] = mail.send.mock.calls[0] as unknown as [string, string, string];
      expect(html).toContain("billing?plan=pro&from=trial_email_ended");
      expect(html).toContain("So far Acme Studio has");
    });

    it("leaves Lifetime out once it has sold out", async () => {
      const { task, mail } = build({ reminders: [row()], seatsRemaining: 0 });
      await task.sendEndingReminders(NOW);
      const [, , html] = mail.send.mock.calls[0] as unknown as [string, string, string];
      expect(html).not.toContain("plan=lifetime");
    });

    it("leaves Lifetime out when the plan is switched off", async () => {
      const { task, mail } = build({ reminders: [row()], lifetimeActive: false });
      await task.sendEndingReminders(NOW);
      const [, , html] = mail.send.mock.calls[0] as unknown as [string, string, string];
      expect(html).not.toContain("plan=lifetime");
    });

    it("looks up Lifetime once per run, not once per workspace", async () => {
      const { task, prisma, billing } = build({ reminders: [row(), row({ id: "sub2", organizationId: "org2" })] });
      await task.sendEndingReminders(NOW);
      expect(billing.getLifetimeSeatsRemaining).toHaveBeenCalledTimes(1);
      expect(prisma.subscriptionPlan.findUnique).toHaveBeenCalledTimes(1);
    });

    it("logs an undelivered email as an error", async () => {
      const { task, logger } = build({ reminders: [row()], sent: false });
      await task.sendEndingReminders(NOW);
      expect(logger.error).toHaveBeenCalled();
      const [message] = logger.error.mock.calls[0] as unknown as [string];
      expect(message).toContain("org1");
    });
  });
});
