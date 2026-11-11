import { describe, expect, it } from "bun:test";
import { debounce } from "./debounce";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("debounce", () => {
  it("collapses a burst into one call with the last value", async () => {
    const seen: string[] = [];
    const save = debounce<string>((v) => seen.push(v), 20);
    save("#111111");
    save("#222222");
    save("#333333");
    expect(seen).toEqual([]);
    await wait(50);
    expect(seen).toEqual(["#333333"]);
  });

  it("flush runs the pending call immediately, once", async () => {
    const seen: string[] = [];
    const save = debounce<string>((v) => seen.push(v), 20);
    save("#111111");
    save.flush();
    expect(seen).toEqual(["#111111"]);
    save.flush();
    await wait(50);
    expect(seen).toEqual(["#111111"]);
  });
});
