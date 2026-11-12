import { describe, expect, it } from "bun:test";
import { lifetimeSeatLabel } from "@atrium/shared";

describe("lifetimeSeatLabel", () => {
  it("shows the cap while nobody has bought a seat", () => {
    expect(lifetimeSeatLabel(100, 100)).toBe("Limited to 100 seats");
  });

  it("still shows the cap at 49 sold", () => {
    expect(lifetimeSeatLabel(100, 51)).toBe("Limited to 100 seats");
  });

  it("shows the live count once 50 have sold", () => {
    expect(lifetimeSeatLabel(100, 50)).toBe("50 of 100 seats remaining");
  });

  it("says sold out at zero", () => {
    expect(lifetimeSeatLabel(100, 0)).toBe("Sold out");
  });
});
