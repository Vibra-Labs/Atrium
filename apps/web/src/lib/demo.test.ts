import { describe, expect, it, afterEach } from "bun:test";
import { isDemoMode } from "./demo";

const original: string | undefined = process.env.NEXT_PUBLIC_DEMO_MODE;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = original;
});

describe("isDemoMode", () => {
  it("is false unless the flag is exactly 'true'", () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    expect(isDemoMode()).toBe(false);
    process.env.NEXT_PUBLIC_DEMO_MODE = "1";
    expect(isDemoMode()).toBe(false);
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
  });

  it("is true when the flag is set", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    expect(isDemoMode()).toBe(true);
  });
});
