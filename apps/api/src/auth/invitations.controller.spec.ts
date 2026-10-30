import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { InvitationsController } from "./invitations.controller";

function build(summary: unknown = null) {
  const auth = {
    describeInvitation: mock(() => Promise.resolve(summary)),
    startInviteSignIn: mock(() => Promise.resolve({ url: "http://api.test/verify?token=t" })),
  };
  return { auth, controller: new InvitationsController(auth as never) };
}

describe("InvitationsController", () => {
  it("is reachable without a session, since the invitee has none yet", () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, InvitationsController)).toBe(true);
  });

  it("describes an open invitation", async () => {
    const summary = { email: "jane@acme.com", organizationName: "Acme", portal: true };
    const { controller } = build(summary);

    expect(await controller.describe("inv-1")).toEqual(summary);
  });

  it("404s an invitation that is no longer open", async () => {
    const { controller } = build(null);

    await expect(controller.describe("inv-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("starts the one-click sign-in", async () => {
    const { auth, controller } = build();

    expect(await controller.signIn("inv-1")).toEqual({ url: "http://api.test/verify?token=t" });
    expect(auth.startInviteSignIn).toHaveBeenCalledWith("inv-1");
  });
});
