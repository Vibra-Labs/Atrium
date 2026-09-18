import { afterEach, describe, expect, it } from "bun:test";
import { copyToClipboard } from "./clipboard";

type FakeTextarea = {
  value: string;
  style: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  select: () => void;
  setSelectionRange: (start: number, end: number) => void;
  focus: () => void;
};

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

function setGlobal(name: "navigator" | "document", value: unknown): void {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>)[name];
    return;
  }
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

/**
 * Stands in for a plain-HTTP browser: no navigator.clipboard, but
 * document.execCommand("copy") still works. Records what was copied.
 */
function fakeExecCommandDocument(execCommandResult: boolean): {
  document: unknown;
  copied: () => string | null;
} {
  let copiedText: string | null = null;
  let attached: FakeTextarea | null = null;

  const doc = {
    createElement: (): FakeTextarea => ({
      value: "",
      style: {},
      setAttribute: () => {},
      select: () => {},
      setSelectionRange: () => {},
      focus: () => {},
    }),
    body: {
      appendChild: (node: FakeTextarea): void => {
        attached = node;
      },
      removeChild: (): void => {
        attached = null;
      },
    },
    activeElement: null,
    execCommand: (command: string): boolean => {
      if (command === "copy" && attached) copiedText = attached.value;
      return execCommandResult;
    },
  };

  return { document: doc, copied: () => copiedText };
}

afterEach(() => {
  setGlobal("navigator", originalNavigator);
  setGlobal("document", originalDocument);
});

describe("copyToClipboard", () => {
  it("uses the async clipboard API in a secure context", async () => {
    let written: string | null = null;
    setGlobal("navigator", {
      clipboard: {
        writeText: async (text: string): Promise<void> => {
          written = text;
        },
      },
    });

    const result = await copyToClipboard("https://atrium.test/invite/abc");

    expect(result).toBe(true);
    expect(written).toBe("https://atrium.test/invite/abc");
  });

  it("falls back to execCommand when navigator.clipboard is undefined over plain HTTP", async () => {
    setGlobal("navigator", {});
    const fake = fakeExecCommandDocument(true);
    setGlobal("document", fake.document);

    const result = await copyToClipboard("http://192.168.1.50:3000/invite/abc");

    expect(result).toBe(true);
    expect(fake.copied()).toBe("http://192.168.1.50:3000/invite/abc");
  });

  it("falls back to execCommand when writeText rejects", async () => {
    setGlobal("navigator", {
      clipboard: {
        writeText: async (): Promise<void> => {
          throw new Error("Write permission denied");
        },
      },
    });
    const fake = fakeExecCommandDocument(true);
    setGlobal("document", fake.document);

    const originalConsoleError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]): void => {
      logged.push(args);
    };

    try {
      const result = await copyToClipboard("secret-link");

      expect(result).toBe(true);
      expect(fake.copied()).toBe("secret-link");
      expect(logged.length).toBe(1);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("returns false when the clipboard is unavailable and the fallback fails", async () => {
    setGlobal("navigator", {});
    const fake = fakeExecCommandDocument(false);
    setGlobal("document", fake.document);

    const result = await copyToClipboard("unreachable");

    expect(result).toBe(false);
  });
});
