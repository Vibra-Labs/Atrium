/** Longest key we store. Client-supplied values (IPs behind a proxy) are truncated. */
const MAX_KEY_LENGTH = 64;

/** In-memory sliding-window limiter. One instance per process is enough for MCP. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep: number = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = 10_000,
    /**
     * What an unknown key arriving at capacity means. True refuses it, which
     * suits a throttle. False admits it untracked, which is what a gate in
     * front of authentication needs: a flood of spoofed keys must never lock
     * out a legitimate caller the map has no room for.
     */
    private readonly failClosedAtCapacity: boolean = true,
  ) {}

  /** True when the key has already spent its budget. May sweep, but records no hit. */
  isLimited(key: string, now: number = Date.now()): boolean {
    const bucket: string = RateLimiter.normalize(key);
    const recent: number[] = this.recentHits(bucket, now);
    if (recent.length >= this.limit) return true;
    if (!this.failClosedAtCapacity) return false;
    return !this.hits.has(bucket) && this.atCapacity(now);
  }

  /** Records a hit and returns whether it was within the budget. */
  allow(key: string, now: number = Date.now()): boolean {
    const bucket: string = RateLimiter.normalize(key);
    // Checked before either outcome, so the map is still swept while refusing.
    const full: boolean = this.atCapacity(now);
    const known: boolean = this.hits.has(bucket);
    const recent: number[] = this.recentHits(bucket, now);

    if (recent.length >= this.limit) {
      this.hits.set(bucket, recent);
      return false;
    }
    // A new key cannot be tracked once the map is full: refuse it, or admit
    // it untracked when this limiter gates authentication.
    if (!known && full) return !this.failClosedAtCapacity;

    recent.push(now);
    this.hits.set(bucket, recent);
    return true;
  }

  private static normalize(key: string): string {
    return key.slice(0, MAX_KEY_LENGTH);
  }

  private recentHits(bucket: string, now: number): number[] {
    const cutoff: number = now - this.windowMs;
    return (this.hits.get(bucket) ?? []).filter((t) => t > cutoff);
  }

  /** True when no new key can be admitted, after at most one sweep per window. */
  private atCapacity(now: number): boolean {
    if (this.hits.size < this.maxKeys) return false;
    this.sweep(now);
    return this.hits.size >= this.maxKeys;
  }

  /** Drops keys whose hits have all fallen out of the window. At most once per window. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff: number = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }
}
