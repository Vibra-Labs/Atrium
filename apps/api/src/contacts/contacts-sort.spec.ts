import { describe, expect, it } from "bun:test";
import { contactSortValue, rankRows } from "./contacts-sort";
import type { SortableContact } from "./contacts-sort";

const row = (id: string, name: string, over: Partial<SortableContact> = {}): SortableContact => ({
  id,
  name,
  status: "lead",
  companyName: null,
  followUpAt: null,
  ...over,
});

describe("rankRows", () => {
  it("orders numbers either way and breaks ties by name, then id", () => {
    const rows = [row("b", "Bo"), row("a", "Ann"), row("c", "Ann"), row("d", "Di")];
    const paid = new Map([["d", 50]]);
    const value = (r: SortableContact): number => paid.get(r.id) ?? 0;
    expect(rankRows(rows, "desc", value)).toEqual(["d", "a", "c", "b"]);
    expect(rankRows(rows, "asc", value)).toEqual(["a", "c", "b", "d"]);
  });

  it("keeps empty values last in both directions", () => {
    const rows = [row("a", "Ann", { companyName: "Zeta" }), row("b", "Bo"), row("c", "Cy", { companyName: "acme" })];
    const value = (r: SortableContact): string | null => r.companyName;
    expect(rankRows(rows, "asc", value)).toEqual(["c", "a", "b"]);
    expect(rankRows(rows, "desc", value)).toEqual(["a", "c", "b"]);
  });
});

describe("contactSortValue", () => {
  const paid = new Map([["a", 900]]);

  it("ranks status in pipeline order: lead, client, past client", () => {
    const rows = [row("p", "P", { status: "past_client" }), row("c", "C", { status: "client" }), row("l", "L")];
    expect(rankRows(rows, "asc", (r) => contactSortValue("status", r, paid))).toEqual(["l", "c", "p"]);
  });

  it("reads every list column", () => {
    const due = new Date("2026-11-05T12:00:00Z");
    const r = row("a", "Ann", { companyName: "Acme", followUpAt: due, status: "client" });
    expect(contactSortValue("name", r, paid)).toBe("Ann");
    expect(contactSortValue("company", r, paid)).toBe("Acme");
    expect(contactSortValue("followUp", r, paid)).toBe(due.getTime());
    expect(contactSortValue("followUp", row("b", "Bo"), paid)).toBeNull();
    expect(contactSortValue("paid", r, paid)).toBe(900);
    expect(contactSortValue("paid", row("b", "Bo"), paid)).toBe(0);
  });
});
