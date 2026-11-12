import { describe, expect, it, mock } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { PlanOffersController } from "./plan-offers.controller";
import type { PlanOffersService } from "./plan-offers.service";

function build() {
  const service = {
    due: mock(() => Promise.resolve({ offer: "early", activity: null })),
    record: mock(() => Promise.resolve({ claimed: true })),
  };
  return { controller: new PlanOffersController(service as unknown as PlanOffersService), service };
}

describe("PlanOffersController", () => {
  it("returns the due offer for the workspace", async () => {
    const { controller, service } = build();
    expect(await controller.due("org-1")).toEqual({ offer: "early", activity: null });
    expect(service.due).toHaveBeenCalledWith("org-1");
  });

  it("records an outcome for a known offer", async () => {
    const { controller, service } = build();
    expect(await controller.record("org-1", "usage", { outcome: "shown" })).toEqual({ claimed: true });
    expect(service.record).toHaveBeenCalledWith("org-1", "usage", "shown");
  });

  it("rejects an unknown offer", async () => {
    const { controller, service } = build();
    await expect(controller.record("org-1", "surprise", { outcome: "shown" })).rejects.toBeInstanceOf(BadRequestException);
    expect(service.record).not.toHaveBeenCalled();
  });
});
