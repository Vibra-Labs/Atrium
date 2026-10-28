import { describe, expect, it, mock } from "bun:test";
import { ActivityController } from "./activity.controller";
import type { ActivityService } from "./activity.service";

function build() {
  const service = { findByOrg: mock(() => Promise.resolve([])) };
  return { service, controller: new ActivityController(service as unknown as ActivityService) };
}

describe("ActivityController", () => {
  it.each([
    [undefined, 10],
    ["5", 5],
    ["500", 50],
    ["0", 10],
    ["-3", 1],
    ["abc", 10],
  ])("limit %p becomes %p", (limit, expected) => {
    const { service, controller } = build();
    controller.findAll("org-1", limit);
    expect(service.findByOrg).toHaveBeenCalledWith("org-1", expected);
  });
});
