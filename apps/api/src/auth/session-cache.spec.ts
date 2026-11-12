import { describe, expect, it } from "bun:test";
import { SessionCache } from "./session-cache";
import type { CachedSession } from "./session-cache";

function entry(userId: string, ttlMs = 30_000): CachedSession {
  return {
    user: { id: userId } as CachedSession["user"],
    session: { id: `s-${userId}` } as CachedSession["session"],
    expiresAt: Date.now() + ttlMs,
  };
}

describe("SessionCache", () => {
  it("returns a live entry", () => {
    const cache = new SessionCache();
    cache.set("t1", entry("u1"));
    expect(cache.get("t1")?.user.id).toBe("u1");
  });

  it("drops an expired entry on read", () => {
    const cache = new SessionCache();
    cache.set("t1", entry("u1", -1));
    expect(cache.get("t1")).toBeUndefined();
  });

  it("deleteUser drops only that user's entries", () => {
    const cache = new SessionCache();
    cache.set("t1", entry("u1"));
    cache.set("t2", entry("u1"));
    cache.set("t3", entry("u2"));
    cache.deleteUser("u1");
    expect(cache.get("t1")).toBeUndefined();
    expect(cache.get("t2")).toBeUndefined();
    expect(cache.get("t3")?.user.id).toBe("u2");
  });
});
