import { describe, expect, it } from "bun:test";
import { parseCsv } from "./contacts-csv";

describe("parseCsv", () => {
  it("strips BOM and handles quoted commas", () => {
    expect(parseCsv('﻿Name,Notes\r\n"Doe, Jane","said ""hi"""\r\n')).toEqual([
      ["Name", "Notes"],
      ["Doe, Jane", 'said "hi"'],
    ]);
  });

  it("handles newlines in quotes, LF endings and blank lines", () => {
    expect(parseCsv('a,b\n"x\ny",z\n\n')).toEqual([
      ["a", "b"],
      ["x\ny", "z"],
    ]);
  });
});
