import { describe, expect, it } from "bun:test";
import { PreviewModeGuard } from "./preview-mode.guard";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";

function buildContext(method: string, previewMode: boolean): ExecutionContext {
  const request = { method, previewMode };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => {},
    }),
  } as unknown as ExecutionContext;
}

describe("PreviewModeGuard", () => {
  const guard = new PreviewModeGuard();

  it("allows GET when previewMode is true", () => {
    expect(guard.canActivate(buildContext("GET", true))).toBe(true);
  });

  it("allows HEAD when previewMode is true", () => {
    expect(guard.canActivate(buildContext("HEAD", true))).toBe(true);
  });

  it("rejects POST when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("POST", true))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects PUT when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("PUT", true))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects PATCH when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("PATCH", true))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects DELETE when previewMode is true", () => {
    expect(() => guard.canActivate(buildContext("DELETE", true))).toThrow(
      ForbiddenException,
    );
  });

  it("allows POST when previewMode is false", () => {
    expect(guard.canActivate(buildContext("POST", false))).toBe(true);
  });

  it("allows POST when previewMode flag is missing", () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST" }),
        getResponse: () => ({}),
        getNext: () => () => {},
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
