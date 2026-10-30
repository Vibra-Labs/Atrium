/**
 * Allows at most `max` sends per key in a rolling window. Kept in memory, so a
 * restart clears it; callers only pass keys for existing accounts, which keeps
 * the map bounded.
 */
export class SendLimiter {
  private readonly sent = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const recent: number[] = (this.sent.get(key) ?? []).filter((t: number) => now - t < this.windowMs);
    const allowed: boolean = recent.length < this.max;
    if (allowed) recent.push(now);
    this.sent.set(key, recent);
    return allowed;
  }
}
