import { describe, expect, it } from "bun:test";
import { createLatestSaver } from "./latest-saver";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createLatestSaver", () => {
  it("never overlaps sends and finishes with the latest value", async () => {
    const sent: string[] = [];
    const gates: Deferred[] = [];
    let settled = 0;
    const save = createLatestSaver<string>(
      (value) => {
        sent.push(value);
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
      () => {
        settled += 1;
      },
    );

    const first = save("date, repeat null");
    save("date, repeat 30");
    const last = save("date, repeat 90");
    expect(sent).toEqual(["date, repeat null"]);

    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual(["date, repeat null", "date, repeat 90"]);
    expect(settled).toBe(0);

    gates[1].resolve();
    await first;
    await last;
    expect(sent).toEqual(["date, repeat null", "date, repeat 90"]);
    expect(settled).toBe(1);
  });

  it("keeps going after a failed send", async () => {
    const sent: number[] = [];
    let settled = 0;
    const save = createLatestSaver<number>(
      async (value) => {
        sent.push(value);
        if (value === 1) throw new Error("boom");
      },
      () => {
        settled += 1;
      },
    );

    await save(1);
    await save(2);
    expect(sent).toEqual([1, 2]);
    expect(settled).toBe(2);
  });
});
