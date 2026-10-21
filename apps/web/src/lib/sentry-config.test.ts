import { describe, expect, it } from "bun:test";
import { shouldBundleSentry, shouldInitServerSentry } from "./sentry-config";

describe("shouldBundleSentry", () => {
  it("is false without a public DSN", () => {
    expect(shouldBundleSentry({})).toBe(false);
    expect(shouldBundleSentry({ NEXT_PUBLIC_SENTRY_DSN: "" })).toBe(false);
  });

  it("is true with a public DSN", () => {
    expect(shouldBundleSentry({ NEXT_PUBLIC_SENTRY_DSN: "https://k@sentry.io/1" })).toBe(true);
  });
});

describe("shouldInitServerSentry", () => {
  it("is false without a server DSN, even when the public one is set", () => {
    expect(shouldInitServerSentry({ NEXT_PUBLIC_SENTRY_DSN: "https://k@sentry.io/1" })).toBe(false);
  });

  it("is true with a server DSN", () => {
    expect(shouldInitServerSentry({ SENTRY_DSN: "https://k@sentry.io/1" })).toBe(true);
  });
});
