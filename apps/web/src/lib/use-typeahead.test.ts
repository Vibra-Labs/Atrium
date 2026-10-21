import { describe, expect, it } from "bun:test";
import { typeaheadUrl } from "./use-typeahead";

describe("typeaheadUrl", () => {
  it("asks the server for at most 10 matches and encodes the term", () => {
    expect(typeaheadUrl("/companies", "R&D Co")).toBe("/companies?search=R%26D%20Co&limit=10");
  });
});
