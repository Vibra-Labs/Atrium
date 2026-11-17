import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { DemoController } from "./demo.controller";
import type { DemoService } from "./demo.service";
import type { AuthService } from "../auth/auth.service";

interface FakeResponse {
  redirect: ReturnType<typeof mock>;
}

function build(options: { enabled?: boolean; inDemoOrg?: boolean } = {}) {
  const enabled: boolean = options.enabled ?? true;
  const inDemoOrg: boolean = options.inDemoOrg ?? true;
  const auth = {
    startDemoSignIn: mock(() => Promise.resolve({ url: "http://api.test/verify?token=t" })),
  };
  const resetService = { reset: mock(() => Promise.resolve({ reset: true })) };
  const demo = {
    enabled,
    touch: mock(() => {}),
    isDemoOrg: mock(() => Promise.resolve(inDemoOrg)),
  };
  const res: FakeResponse = { redirect: mock(() => {}) };
  return {
    auth,
    demo,
    res,
    resetService,
    controller: new DemoController(
      auth as unknown as AuthService,
      demo as unknown as DemoService,
      resetService as never,
    ),
  };
}

describe("DemoController", () => {
  it("is reachable without a session, since a demo visitor has none", () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, DemoController)).toBe(true);
  });

  it("302s to the captured verify URL", async () => {
    const { controller, res, auth } = build();

    await controller.enter({ kind: "owner" }, res as never);

    expect(auth.startDemoSignIn).toHaveBeenCalledWith("owner");
    expect(res.redirect).toHaveBeenCalledWith(302, "http://api.test/verify?token=t");
  });

  it("records activity on entry, so a reset does not land on a new visitor", async () => {
    const { controller, res, demo } = build();

    await controller.enter({ kind: "client" }, res as never);

    expect(demo.touch).toHaveBeenCalled();
  });

  it("404s on enter when demo mode is off", async () => {
    const { controller, res, auth } = build({ enabled: false });

    await expect(controller.enter({ kind: "owner" }, res as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(auth.startDemoSignIn).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("resets the demo for someone inside it, forcing past the quiet period", async () => {
    // The visitor pressing the button is itself the recent activity, so an
    // unforced reset would refuse their own request.
    const { controller, resetService } = build();

    expect(await controller.reset({ organization: { id: "org-demo" } } as never)).toEqual({
      reset: true,
    });
    expect(resetService.reset).toHaveBeenCalledWith({ force: true });
  });

  it("refuses a reset from outside the demo workspace", async () => {
    const { controller, resetService } = build({ inDemoOrg: false });

    await expect(
      controller.reset({ organization: { id: "org-real" } } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resetService.reset).not.toHaveBeenCalled();
  });

  it("404s on reset when demo mode is off", async () => {
    const { controller, resetService } = build({ enabled: false });

    await expect(
      controller.reset({ organization: { id: "org-demo" } } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(resetService.reset).not.toHaveBeenCalled();
  });
});
