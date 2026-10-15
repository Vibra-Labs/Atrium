import { describe, expect, it, mock } from "bun:test";
import { LastSeenTracker, LAST_SEEN_INTERVAL_MS } from "./last-seen.tracker";

function build(updateFails = false) {
  const prisma = {
    member: {
      updateMany: mock(() => (updateFails ? Promise.reject(new Error("db down")) : Promise.resolve({ count: 1 }))),
    },
  };
  return { tracker: new LastSeenTracker(prisma as never), prisma };
}

describe("LastSeenTracker", () => {
  it("records the visit time for a member", async () => {
    const { tracker, prisma } = build();
    const now = new Date("2026-10-14T12:00:00Z");
    await tracker.touch("m1", now);
    expect(prisma.member.updateMany).toHaveBeenCalledWith({ where: { id: "m1" }, data: { lastSeenAt: now } });
  });

  it("writes at most once per interval for the same member", async () => {
    const { tracker, prisma } = build();
    const t0 = new Date("2026-10-14T12:00:00Z");
    await tracker.touch("m1", t0);
    await tracker.touch("m1", new Date(t0.getTime() + LAST_SEEN_INTERVAL_MS - 1));
    expect(prisma.member.updateMany).toHaveBeenCalledTimes(1);
    await tracker.touch("m1", new Date(t0.getTime() + LAST_SEEN_INTERVAL_MS));
    expect(prisma.member.updateMany).toHaveBeenCalledTimes(2);
  });

  it("tracks members independently", async () => {
    const { tracker, prisma } = build();
    const now = new Date();
    await tracker.touch("m1", now);
    await tracker.touch("m2", now);
    expect(prisma.member.updateMany).toHaveBeenCalledTimes(2);
  });

  it("swallows write failures and retries on the next visit", async () => {
    const { tracker, prisma } = build(true);
    const now = new Date();
    await expect(tracker.touch("m1", now)).resolves.toBeUndefined();
    await tracker.touch("m1", now);
    expect(prisma.member.updateMany).toHaveBeenCalledTimes(2);
  });
});
