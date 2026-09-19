import { describe, expect, it } from "bun:test";
import { bearerToken } from "./bearer-token";

describe("bearerToken", () => {
  it("reads the token from a well-formed header", () => {
    expect(bearerToken("Bearer atr_abc")).toBe("atr_abc");
  });

  it("matches the scheme in any case, per RFC 7235", () => {
    expect(bearerToken("bearer atr_abc")).toBe("atr_abc");
    expect(bearerToken("BEARER atr_abc")).toBe("atr_abc");
    expect(bearerToken("BeArEr atr_abc")).toBe("atr_abc");
  });

  it("tolerates extra whitespace around the token", () => {
    expect(bearerToken("Bearer   atr_abc  ")).toBe("atr_abc");
    expect(bearerToken("Bearer\tatr_abc")).toBe("atr_abc");
  });

  it("returns undefined when there is no token to read", () => {
    // A scheme with only whitespace after it carries no credentials, so every
    // caller must agree it is not a bearer request.
    expect(bearerToken("Bearer   ")).toBeUndefined();
    expect(bearerToken("Bearer")).toBeUndefined();
    expect(bearerToken("Bearer ")).toBeUndefined();
    expect(bearerToken("")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });

  it("ignores other authentication schemes", () => {
    expect(bearerToken("Basic atr_abc")).toBeUndefined();
    expect(bearerToken("Bearerish atr_abc")).toBeUndefined();
    expect(bearerToken("atr_abc")).toBeUndefined();
  });
});
