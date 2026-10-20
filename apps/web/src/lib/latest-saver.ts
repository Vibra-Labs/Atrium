/**
 * Serializes saves: one `send` at a time, and calls made while one is in flight collapse into a
 * single follow-up send with the latest value, so an older value can never land last.
 * `onSettled` runs once the queue drains.
 */
export function createLatestSaver<T>(
  send: (value: T) => Promise<void>,
  onSettled: () => void,
): (value: T) => Promise<void> {
  let running = false;
  let next: { value: T } | null = null;

  return async function save(value: T): Promise<void> {
    next = { value };
    if (running) return;
    running = true;
    try {
      while (next) {
        const current: T = next.value;
        next = null;
        try {
          await send(current);
        } catch (err) {
          console.error(err);
        }
      }
    } finally {
      running = false;
    }
    onSettled();
  };
}
