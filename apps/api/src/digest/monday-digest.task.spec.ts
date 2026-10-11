import { describe, expect, it, mock } from "bun:test";
import { MondayDigestTask, digestSubject } from "./monday-digest.task";
import type { MondayDigest } from "./monday-digest.service";

const NOW = new Date("2026-10-12T08:00:00Z");
const SIX_DAYS_AGO = new Date("2026-10-06T08:00:00Z");

const MEMBER = {
  id: "m1",
  userId: "u1",
  organizationId: "org1",
  user: { email: "jenn@studio.test" },
  organization: { name: "Klout Creative", systemSettings: { timezone: null } },
};

const FULL: MondayDigest = {
  tasks: [
    { title: "Send proofs", projectName: "Living Unlimited", dueDate: new Date("2026-10-09T00:00:00Z"), overdue: true },
    { title: "Kickoff call", projectName: "New Site", dueDate: new Date("2026-10-14T00:00:00Z"), overdue: false },
  ],
  taskTotal: 2,
  activity: [{ title: "New comment on Homepage", message: "Looks great!", link: "/dashboard/projects/p1" }],
  activityTotal: 1,
  overdueInvoices: [{ invoiceNumber: "INV-0004", dueDate: new Date("2026-10-01T00:00:00Z"), projectId: "p1" }],
  isEmpty: false,
};

const EMPTY: MondayDigest = {
  tasks: [], taskTotal: 0, activity: [], activityTotal: 0, overdueInvoices: [], isEmpty: true,
};

function build(opts: { digest?: MondayDigest; claimCount?: number; sent?: boolean; members?: unknown[] } = {}) {
  const prisma = {
    member: {
      findMany: mock(() => Promise.resolve(opts.members ?? [MEMBER])),
      updateMany: mock(() => Promise.resolve({ count: opts.claimCount ?? 1 })),
      update: mock(() => Promise.resolve({})),
    },
  };
  const digests = { collect: mock(() => Promise.resolve(opts.digest ?? FULL)) };
  const mail = { send: mock(() => Promise.resolve({ sent: opts.sent ?? true, viaOrgConfig: false })) };
  const config = { get: (k: string, fallback?: string) => (k === "WEB_URL" ? "https://app.atrium.test" : fallback) };
  const task = new MondayDigestTask(prisma as never, digests as never, mail as never, config as never);
  return { task, prisma, digests, mail };
}

describe("digestSubject", () => {
  it("summarises only the parts that have something in them", () => {
    expect(digestSubject(FULL)).toBe("Your week: 2 tasks due, 1 update, 1 overdue invoice");
    expect(digestSubject({ ...EMPTY, taskTotal: 1, isEmpty: false })).toBe("Your week: 1 task due");
  });
});

describe("MondayDigestTask", () => {
  it("only considers owners and admins who kept the digest on and weren't sent one this week", async () => {
    const { task, prisma } = build();
    await task.sendDigests(NOW);
    const call = prisma.member.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(call[0].where).toEqual({
      role: { in: ["owner", "admin"] },
      mondayDigest: true,
      OR: [{ mondayDigestSentAt: null }, { mondayDigestSentAt: { lt: SIX_DAYS_AGO } }],
    });
  });

  it("emails what's due, what changed and overdue invoices, through the workspace's mail settings", async () => {
    const { task, mail, digests } = build();
    await task.sendDigests(NOW);
    expect(digests.collect).toHaveBeenCalledWith({ userId: "u1", organizationId: "org1" }, NOW);

    const [to, subject, html, orgId] = mail.send.mock.calls[0] as unknown as [string, string, string, string];
    expect(to).toBe("jenn@studio.test");
    expect(subject).toBe("Your week: 2 tasks due, 1 update, 1 overdue invoice");
    expect(orgId).toBe("org1");
    expect(html).toContain("Send proofs");
    expect(html).toContain("overdue since Oct 9");
    expect(html).toContain("due Oct 14");
    expect(html).toContain("https://app.atrium.test/dashboard/projects/p1");
    expect(html).toContain("https://app.atrium.test/dashboard/projects/p1?tab=invoices");
    expect(html).toContain("https://app.atrium.test/dashboard/settings/account#notifications");
  });

  it("sends nothing when there is nothing to do", async () => {
    const { task, mail, prisma } = build({ digest: EMPTY });
    await task.sendDigests(NOW);
    expect(prisma.member.updateMany).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("sends nothing when another instance already claimed this week's digest", async () => {
    const { task, mail } = build({ claimCount: 0 });
    await task.sendDigests(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("keeps the claim when the email could not be sent, so it does not retry every hour", async () => {
    const { task, prisma } = build({ sent: false });
    await task.sendDigests(NOW);
    expect(prisma.member.update).not.toHaveBeenCalled();
  });

  it("waits for Monday 08:00 in the workspace's own timezone", async () => {
    // 08:00 UTC on Monday is 01:00 in Los Angeles; 15:00 UTC is 08:00 there.
    const la = { ...MEMBER, organization: { ...MEMBER.organization, systemSettings: { timezone: "America/Los_Angeles" } } };
    const early = build({ members: [la] });
    await early.task.sendDigests(NOW);
    expect(early.mail.send).not.toHaveBeenCalled();

    const later = build({ members: [la] });
    await later.task.sendDigests(new Date("2026-10-12T15:00:00Z"));
    expect(later.mail.send).toHaveBeenCalledTimes(1);
  });
});
