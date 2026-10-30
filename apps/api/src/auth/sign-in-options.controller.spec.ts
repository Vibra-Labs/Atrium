import { describe, expect, it, mock } from "bun:test";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { SignInOptionsController } from "./sign-in-options.controller";

describe("SignInOptionsController", () => {
  it("is reachable from the login page, before anyone signs in", () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, SignInOptionsController)).toBe(true);
  });

  it("reports whether sign-in links can be emailed", async () => {
    const auth = { signInLinksAvailable: mock(() => Promise.resolve(false)) };
    const controller = new SignInOptionsController(auth as never);

    expect(await controller.get()).toEqual({ magicLink: false });
  });
});
