import { describe, expect, it } from "bun:test";
import { rowClickAction, type RowClickInfo } from "./row-link";

const plain: RowClickInfo = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  insideInteractive: false,
  hasSelection: false,
};

describe("rowClickAction", () => {
  it("navigates on a plain left click", () => {
    expect(rowClickAction(plain)).toBe("navigate");
  });

  it("opens a new tab on cmd/ctrl/shift click and middle click", () => {
    expect(rowClickAction({ ...plain, metaKey: true })).toBe("new-tab");
    expect(rowClickAction({ ...plain, ctrlKey: true })).toBe("new-tab");
    expect(rowClickAction({ ...plain, shiftKey: true })).toBe("new-tab");
    expect(rowClickAction({ ...plain, button: 1 })).toBe("new-tab");
  });

  it("ignores clicks on inner controls, text selections and right clicks", () => {
    expect(rowClickAction({ ...plain, insideInteractive: true })).toBe("ignore");
    expect(rowClickAction({ ...plain, button: 1, insideInteractive: true })).toBe("ignore");
    expect(rowClickAction({ ...plain, hasSelection: true })).toBe("ignore");
    expect(rowClickAction({ ...plain, button: 2 })).toBe("ignore");
  });
});
