import { describe, expect, it, mock } from "bun:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
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
    controller: new DemoController(
      auth as unknown as AuthService,
      demo as unknown as DemoService,
    ),
  };
}

describe("DemoController", () => {
  it("is reachable without a session, since a demo visitor has none", () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, DemoController)).toBe(true);
  });

  it("302s to the captured verify URL", async () => {
    const { controller, res, auth } = build();

    await controller.enter("owner", res as never);

    expect(auth.startDemoSignIn).toHaveBeenCalledWith("owner");
    // 303, not 302: it is the only redirect that *requires* every client to
    // switch the follow-up to GET. The verify endpoint is GET-only, and curl
    // re-POSTs a 302 and gets a 404.
    expect(res.redirect).toHaveBeenCalledWith(303, "http://api.test/verify?token=t");
  });

  it("records activity on entry, so a reset does not land on a new visitor", async () => {
    const { controller, res, demo } = build();

    await controller.enter("client", res as never);

    expect(demo.touch).toHaveBeenCalled();
  });

  it("rejects a kind it does not recognise", async () => {
    const { controller, res, auth } = build();

    await expect(controller.enter("admin" as never, res as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(auth.startDemoSignIn).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("lets a visitor in more than ten times a minute", async () => {
    // Entry is one POST per visitor, and a public demo's visitors arrive in
    // bursts and share egress IPs — one office, one conference, one school
    // behind a single NAT. At ten a minute the eleventh of them met a raw 429
    // on the only door into the product. The limit is still here to stop a
    // crawler spending sign-in links; it just isn't tuned to reject a crowd.
    // @nestjs/throttler keys its metadata per named limiter: "THROTTLER:LIMIT"
    // plus the limiter's name.
    const limit = Reflect.getMetadata(
      "THROTTLER:LIMITdefault",
      DemoController.prototype.enter,
    ) as number | undefined;
    expect(limit).toBeGreaterThanOrEqual(30);
  });

  it("404s on enter when demo mode is off", async () => {
    const { controller, res, auth } = build({ enabled: false });

    await expect(controller.enter("owner", res as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(auth.startDemoSignIn).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
