import { describe, expect, it, mock } from "bun:test";
import { FollowUpTask } from "./follow-up.task";
import { InAppNotificationsService } from "../notifications/in-app-notifications.service";

const NOW = new Date("2026-10-20T10:00:00Z");

interface FakeContact {
  id: string;
  name: string;
  organizationId: string;
  followUpAt: Date | null;
  followUpOwnerId: string | null;
  followUpNotifiedAt: Date | null;
}

interface NotificationRow {
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  message: string;
  link: string;
}

interface ClaimArgs {
  where: { id: string; followUpNotifiedAt: null; followUpAt: Date | null };
  data: { followUpNotifiedAt: Date };
}

function fake(id: string): FakeContact {
  return {
    id,
    name: id === "c1" ? "Ann" : id,
    organizationId: "org1",
    followUpAt: new Date("2026-10-14T00:00:00Z"),
    followUpOwnerId: "u1",
    followUpNotifiedAt: null,
  };
}

function build(opts: { contacts?: FakeContact[]; adminIds?: string[]; ownerIds?: string[]; otherOrgOwnerIds?: string[] } = {}) {
  const contacts: FakeContact[] = opts.contacts ?? [fake("c1")];
  const sent: NotificationRow[] = [];
  const claim = mock((a: ClaimArgs) => {
    const c = contacts.find((x) => x.id === a.where.id);
    const same = c?.followUpAt?.getTime() === a.where.followUpAt?.getTime();
    if (!c || c.followUpNotifiedAt !== null || !same) return Promise.resolve({ count: 0 });
    c.followUpNotifiedAt = a.data.followUpNotifiedAt;
    return Promise.resolve({ count: 1 });
  });
  const createMany = mock((a: { data: NotificationRow[] }) => {
    sent.push(...a.data);
    return Promise.resolve({ count: a.data.length });
  });
  const tx = { contact: { updateMany: claim }, notification: { createMany } };
  const prisma = {
    contact: {
      findMany: mock(() =>
        Promise.resolve(
          contacts.filter((c) => c.followUpAt && c.followUpAt <= NOW && !c.followUpNotifiedAt).map((c) => ({ ...c })),
        ),
      ),
    },
    member: {
      findMany: mock(() =>
        Promise.resolve([
          ...(opts.adminIds ?? ["u1"]).map((userId) => ({ organizationId: "org1", userId, role: "admin" })),
          ...(opts.ownerIds ?? []).map((userId) => ({ organizationId: "org1", userId, role: "owner" })),
          ...(opts.otherOrgOwnerIds ?? []).map((userId) => ({ organizationId: "org2", userId, role: "owner" })),
        ]),
      ),
    },
    // Rolls the claim back when the callback throws, as Postgres would.
    $transaction: mock(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const before = contacts.map((c) => c.followUpNotifiedAt);
      try {
        return await fn(tx);
      } catch (err) {
        contacts.forEach((c, i) => (c.followUpNotifiedAt = before[i]));
        throw err;
      }
    }),
  };
  // The real service, so reminders are shown to go through it inside the claim's transaction.
  const task = new FollowUpTask(prisma as never, new InAppNotificationsService(prisma as never));
  return { task, prisma, createMany, contacts, sent };
}

describe("FollowUpTask", () => {
  it("sendDue notifies once", async () => {
    const { task, sent } = build();
    expect(await task.sendDue(NOW)).toBe(1);
    expect(sent).toEqual([
      {
        userId: "u1",
        organizationId: "org1",
        type: "contact_follow_up",
        title: "Follow up with Ann",
        message: "Follow-up due Oct 14, 2026",
        link: "/dashboard/contacts/c1",
      },
    ]);
    expect(await task.sendDue(NOW)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("sendDue re-notifies after date changes", async () => {
    const { task, sent, contacts } = build();
    await task.sendDue(NOW);
    // setFollowUp / snooze / done reset the marker alongside the new date
    contacts[0].followUpAt = new Date("2026-10-19T00:00:00Z");
    contacts[0].followUpNotifiedAt = null;
    expect(await task.sendDue(NOW)).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("sendDue falls back to owners when follow-up owner left", async () => {
    const { task, sent } = build({ adminIds: [], ownerIds: ["o1", "o2"] });
    expect(await task.sendDue(NOW)).toBe(1);
    expect(sent.map((n) => n.userId)).toEqual(["o1", "o2"]);
  });

  it("writes every recipient's reminder together, so a failure sends none and retries next run", async () => {
    const { task, createMany, contacts, sent } = build({ adminIds: [], ownerIds: ["o1", "o2"] });
    createMany.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    expect(await task.sendDue(NOW)).toBe(0);
    expect(contacts[0].followUpNotifiedAt).toBeNull();
    expect(sent).toHaveLength(0);

    expect(await task.sendDue(NOW)).toBe(1);
    expect(sent.map((n) => n.userId)).toEqual(["o1", "o2"]);
  });

  it("one failing contact does not stop the rest", async () => {
    const { task, createMany, contacts } = build({ contacts: [fake("a"), fake("b")] });
    createMany.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    expect(await task.sendDue(NOW)).toBe(1);
    expect(contacts[0].followUpNotifiedAt).toBeNull();
    expect(contacts[1].followUpNotifiedAt).toEqual(NOW);
  });

  it("skips a contact another run already claimed", async () => {
    const { task, prisma, contacts, sent } = build();
    // Another replica claims it between this run's read and its claim.
    prisma.contact.findMany.mockImplementationOnce(async () => {
      const rows = contacts.map((c) => ({ ...c }));
      contacts[0].followUpNotifiedAt = NOW;
      return rows;
    });
    expect(await task.sendDue(NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("skips a contact whose follow-up moved after it was read", async () => {
    const { task, prisma, contacts, sent } = build();
    prisma.contact.findMany.mockImplementationOnce(async () => {
      const rows = contacts.map((c) => ({ ...c }));
      contacts[0].followUpAt = new Date("2026-11-01T00:00:00Z");
      return rows;
    });
    expect(await task.sendDue(NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not count a contact with no recipients, but marks it notified", async () => {
    const { task, createMany, contacts } = build({ adminIds: [], ownerIds: [] });
    expect(await task.sendDue(NOW)).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    expect(contacts[0].followUpNotifiedAt).toEqual(NOW);
  });

  it("looks up staff once for the whole batch, scoped per workspace", async () => {
    const other = { ...fake("d"), organizationId: "org2", followUpOwnerId: null };
    const { task, prisma, sent } = build({
      contacts: [fake("c1"), fake("c2"), other],
      otherOrgOwnerIds: ["o9"],
    });
    expect(await task.sendDue(NOW)).toBe(3);
    expect(prisma.member.findMany).toHaveBeenCalledTimes(1);
    expect(sent.map((n) => `${n.organizationId}:${n.userId}`)).toEqual(["org1:u1", "org1:u1", "org2:o9"]);
  });
});
