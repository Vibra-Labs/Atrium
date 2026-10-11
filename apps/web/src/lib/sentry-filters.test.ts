import { afterEach, describe, expect, it } from "bun:test";
import type { ErrorEvent } from "@sentry/nextjs";
import { isTranslatorDomError, shouldDropClientEvent } from "./sentry-filters";

const originalDocument = globalThis.document;

function setDocumentClasses(classes: string[] | undefined): void {
  if (classes === undefined) {
    delete (globalThis as Record<string, unknown>).document;
    return;
  }
  const classList = { contains: (c: string) => classes.includes(c) };
  Object.defineProperty(globalThis, "document", {
    value: { documentElement: { classList } },
    configurable: true,
    writable: true,
  });
}

function eventWith(message: string, frames: string[] = []): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "NotFoundError",
          value: message,
          stacktrace: { frames: frames.map((filename) => ({ filename })) },
        },
      ],
    },
  } as ErrorEvent;
}

const removeChild =
  "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.";
const insertBefore =
  "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.";

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    value: originalDocument,
    configurable: true,
    writable: true,
  });
});

describe("isTranslatorDomError", () => {
  it("drops removeChild errors when Google Translate has rewritten the page", () => {
    setDocumentClasses(["translated-ltr"]);
    expect(isTranslatorDomError(eventWith(removeChild))).toBe(true);
  });

  it("drops insertBefore errors under translation too", () => {
    setDocumentClasses(["translated-rtl"]);
    expect(isTranslatorDomError(eventWith(insertBefore))).toBe(true);
  });

  it("keeps removeChild errors when the page is not translated", () => {
    setDocumentClasses([]);
    expect(isTranslatorDomError(eventWith(removeChild))).toBe(false);
  });

  it("keeps unrelated errors even when the page is translated", () => {
    setDocumentClasses(["translated-ltr"]);
    expect(isTranslatorDomError(eventWith("Cannot read properties of undefined"))).toBe(false);
  });

  it("keeps everything when there is no document (SSR)", () => {
    setDocumentClasses(undefined);
    expect(isTranslatorDomError(eventWith(removeChild))).toBe(false);
  });
});

describe("shouldDropClientEvent", () => {
  it("drops errors whose frames all come from outside the Next.js bundle", () => {
    setDocumentClasses([]);
    const event = eventWith("Cannot read properties of undefined (reading 'M_ID')", [
      "app:///executors/200.js",
    ]);
    expect(shouldDropClientEvent(event)).toBe(true);
  });

  it("drops browser-extension frames", () => {
    setDocumentClasses([]);
    const event = eventWith("boom", ["chrome-extension://abc/content.js"]);
    expect(shouldDropClientEvent(event)).toBe(true);
  });

  it("keeps errors with at least one frame from our bundle", () => {
    setDocumentClasses([]);
    const event = eventWith("boom", [
      "app:///executors/200.js",
      "app:///_next/static/chunks/main-app.js",
    ]);
    expect(shouldDropClientEvent(event)).toBe(false);
  });

  it("keeps errors with no frames at all", () => {
    setDocumentClasses([]);
    expect(shouldDropClientEvent(eventWith("boom"))).toBe(false);
  });

  it("drops translator DOM errors", () => {
    setDocumentClasses(["translated-ltr"]);
    const event = eventWith(removeChild, ["app:///_next/static/chunks/react.js"]);
    expect(shouldDropClientEvent(event)).toBe(true);
  });
});
