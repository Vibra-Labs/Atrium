import { describe, expect, it, mock } from "bun:test";
import { DemoResetTask } from "./demo-reset.task";
import type { DemoService } from "./demo.service";
import type { DemoResetService } from "./demo-reset.service";

function build(enabled: boolean) {
  const reset = mock(() => Promise.resolve({ reset: true }));
  const task = new DemoResetTask(
    { enabled } as unknown as DemoService,
    { reset } as unknown as DemoResetService,
  );
  return { task, reset };
}

describe("DemoResetTask", () => {
  it("does nothing on an ordinary install", async () => {
    const { task, reset } = build(false);
    await task.run();
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets on the demo instance", async () => {
    const { task, reset } = build(true);
    await task.run();
    expect(reset).toHaveBeenCalled();
  });

  it("swallows a reset failure so the schedule survives it", async () => {
    const reset = mock(() => Promise.reject(new Error("boom")));
    const task = new DemoResetTask(
      { enabled: true } as unknown as DemoService,
      { reset } as unknown as DemoResetService,
    );
    await task.run();
    expect(reset).toHaveBeenCalled();
  });
});
