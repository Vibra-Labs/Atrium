import { describe, expect, it } from "bun:test";
import { uploadDisabledReason, DEMO_UPLOADS_OFF } from "./demo";

describe("uploadDisabledReason", () => {
  it("is null outside the demo, so uploads work normally", () => {
    expect(uploadDisabledReason(false)).toBeNull();
    expect(uploadDisabledReason(undefined)).toBeNull();
  });

  it("explains why uploads are off in the demo, in the API's own words", () => {
    expect(uploadDisabledReason(true)).toBe(DEMO_UPLOADS_OFF);
    expect(uploadDisabledReason(true)).toBe("Uploads are turned off in the demo.");
  });
});
