import { describe, expect, it, mock } from "bun:test";
import { FollowUpTask } from "./follow-up.task";

const NOW = new Date("2026-10-20T10:00:00Z");

interface FakeContact {
  id: string;
  name: string;
  organizationId: string;
  followUpAt: Date | null;
  followUpOwnerId: string | null;
  followUpNotifiedAt: Date | null;
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

function build(opts: { contacts?: FakeContact[]; adminIds?: string[]; ownerIds?: string[] } = {}) {
  const contacts: FakeContact[] = opts.contacts ?? [fake("c1")];
  const prisma = {
    contact: {
      findMany: mock(() =>
        Promise.resolve(contacts.filter((c) => c.followUpAt && c.followUpAt <= NOW && !c.followUpNotifiedAt)),
      ),
      update: mock((a: { where: { id: string }; data: Partial<FakeContact> }) => {
        Object.assign(contacts.find((c) => c.id === a.where.id)!, a.data);
        return Promise.resolve({});
      }),
    },
    member: {
      findMany: mock((a: { where: { role: string | { in: string[] } } }) =>
        Promise.resolve(
          typeof a.where.role === "string"
            ? (opts.ownerIds ?? []).map((userId) => ({ userId }))
            : (opts.adminIds ?? ["u1"]).map((userId) => ({ userId })),
        ),
      ),
    },
  };
  const notifications = { create: mock((_d: unknown) => Promise.resolve({})) };
  const task = new FollowUpTask(prisma as never, notifications as never);
  return { task, prisma, notifications, contacts };
}

describe("FollowUpTask", () => {
  it("sendDue notifies once", async () => {
    const { task, notifications } = build();
    expect(await task.sendDue(NOW)).toBe(1);
    expect(notifications.create).toHaveBeenCalledWith({
      userId: "u1",
      organizationId: "org1",
      type: "contact_follow_up",
      title: "Follow up with Ann",
      message: "Follow-up due Oct 14, 2026",
      link: "/dashboard/contacts/c1",
    });
    expect(await task.sendDue(NOW)).toBe(0);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it("sendDue re-notifies after date changes", async () => {
    const { task, notifications, contacts } = build();
    await task.sendDue(NOW);
    // setFollowUp / snooze / done reset the marker alongside the new date
    contacts[0].followUpAt = new Date("2026-10-19T00:00:00Z");
    contacts[0].followUpNotifiedAt = null;
    expect(await task.sendDue(NOW)).toBe(1);
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it("sendDue falls back to owners when follow-up owner left", async () => {
    const { task, notifications } = build({ adminIds: [], ownerIds: ["o1", "o2"] });
    expect(await task.sendDue(NOW)).toBe(1);
    const users = notifications.create.mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(users).toEqual(["o1", "o2"]);
  });

  it("one failing contact does not stop the rest", async () => {
    const { task, notifications } = build({ contacts: [fake("a"), fake("b")] });
    notifications.create.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    expect(await task.sendDue(NOW)).toBe(1);
  });
});
