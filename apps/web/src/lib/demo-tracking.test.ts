import { describe, expect, it } from "bun:test";
import { DEMO_ENTERED_EVENT, SIGNUP_COMPLETED_EVENT } from "./demo-tracking";

describe("demo tracking", () => {
  it("counts a demo entry under its own event name", () => {
    expect(DEMO_ENTERED_EVENT).toBe("atrium_demo_entered");
  });

  it("never reuses the signup event, which the funnel is measured by", () => {
    // A demo that inflates the signup count destroys the number it was built
    // to improve.
    expect(DEMO_ENTERED_EVENT).not.toBe(SIGNUP_COMPLETED_EVENT);
  });
});
