import { describe, expect, it } from "bun:test";
import { DEFAULT_LIST_STATE, listQuery, readListState } from "./list-state";
import type { ListState } from "./list-state";

describe("list state in the URL", () => {
  it("leaves defaults out of the address", () => {
    expect(listQuery(DEFAULT_LIST_STATE)).toBe("");
  });

  it("round-trips sort, filters, search, tab and page", () => {
    const state: ListState = {
      tab: "client",
      search: "ann lee",
      page: 3,
      sort: "paid",
      dir: "desc",
      filters: { labelId: "l1", leadSourceId: "", rating: "hot", access: "portal" },
    };
    const query = listQuery(state);
    expect(query).toBe("tab=client&q=ann+lee&page=3&sort=paid&dir=desc&labelId=l1&rating=hot&access=portal");
    expect(readListState(`?${query}`)).toEqual(state);
  });

  it("ignores values that don't belong", () => {
    const state = readListState("?tab=nope&page=-2&sort=email&dir=up&access=everyone&rating=lukewarm");
    expect(state).toEqual(DEFAULT_LIST_STATE);
  });

  it("only keeps a sort that fits the tab", () => {
    expect(readListState("?tab=companies&sort=people").sort).toBe("people");
    expect(readListState("?tab=all&sort=people").sort).toBe("name");
    expect(readListState("?tab=companies&sort=status").sort).toBe("name");
  });

  it("starts a sort at its own default direction when the address has none", () => {
    expect(readListState("?sort=paid").dir).toBe("desc");
    expect(readListState("?sort=company").dir).toBe("asc");
  });

  it("still reads the old ?access= deep link from /dashboard/clients", () => {
    expect(readListState("?access=portal").filters.access).toBe("portal");
  });
});
