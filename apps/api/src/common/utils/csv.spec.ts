import { describe, expect, it } from "bun:test";
import { toCsv } from "./csv";
import type { CsvColumn } from "./csv";

interface TestRow {
  name: string;
  age: number;
  note?: string | null;
}

const columns: CsvColumn<TestRow>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Age", value: (r) => r.age },
  { header: "Note", value: (r) => r.note },
];

describe("toCsv", () => {
  it("produces header row", () => {
    const csv = toCsv(columns, []);
    expect(csv).toBe("Name,Age,Note\r\n");
  });

  it("produces data rows", () => {
    const csv = toCsv(columns, [
      { name: "Alice", age: 30, note: "hello" },
      { name: "Bob", age: 25 },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Name,Age,Note");
    expect(lines[1]).toBe("Alice,30,hello");
    expect(lines[2]).toBe("Bob,25,");
  });

  it("escapes commas in fields", () => {
    const csv = toCsv(columns, [{ name: "Doe, Jane", age: 28 }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe('"Doe, Jane",28,');
  });

  it("escapes double quotes by doubling them", () => {
    const csv = toCsv(columns, [{ name: 'Say "hi"', age: 22 }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe('"Say ""hi""",22,');
  });

  it("escapes newlines in fields", () => {
    const csv = toCsv(columns, [{ name: "Line1\nLine2", age: 20 }]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('"Line1\nLine2",20,');
  });

  it("handles null and undefined values as empty strings", () => {
    const csv = toCsv(columns, [{ name: "Test", age: 0, note: null }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe("Test,0,");
  });
});
