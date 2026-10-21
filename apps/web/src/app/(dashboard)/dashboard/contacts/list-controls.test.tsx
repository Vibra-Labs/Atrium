import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterChips, SortHeader, nextSort } from "./list-controls";
import type { FilterGroup, SortOption } from "./list-controls";

const paid: SortOption = { value: "paid", label: "Paid, all time", defaultDir: "desc" };
const name: SortOption = { value: "name", label: "Name", defaultDir: "asc" };

describe("nextSort", () => {
  it("starts a new column at its default direction", () => {
    expect(nextSort({ sort: "name", dir: "asc" }, paid)).toEqual({ sort: "paid", dir: "desc" });
  });

  it("flips the direction of the current column", () => {
    expect(nextSort({ sort: "name", dir: "asc" }, name)).toEqual({ sort: "name", dir: "desc" });
    expect(nextSort({ sort: "paid", dir: "desc" }, paid)).toEqual({ sort: "paid", dir: "asc" });
  });
});

describe("FilterChips", () => {
  const groups: FilterGroup[] = [
    { key: "rating", label: "Rating", options: [{ value: "hot", label: "Hot" }] },
    { key: "labelId", label: "Tag", options: [{ value: "l-1", label: "VIP" }] },
  ];

  it("renders nothing without active filters", () => {
    expect(renderToStaticMarkup(<FilterChips groups={groups} values={{}} onChange={() => {}} />)).toBe("");
  });

  it("names each active filter by its labels, with a remove button", () => {
    const html: string = renderToStaticMarkup(
      <FilterChips groups={groups} values={{ rating: "hot", labelId: "l-1" }} onChange={() => {}} />,
    );
    expect(html).toContain("Rating is</span>");
    expect(html).toContain("Hot");
    expect(html).toContain("VIP");
    expect(html).toContain('aria-label="Remove Rating filter"');
    expect(html).toContain("Clear");
  });
});

describe("SortHeader", () => {
  function header(sort: string, dir: "asc" | "desc"): string {
    return renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <SortHeader option={paid} sort={sort} dir={dir} onSort={() => {}} />
          </tr>
        </thead>
      </table>,
    );
  }

  it("marks the sorted column for screen readers", () => {
    expect(header("paid", "desc")).toContain('aria-sort="descending"');
    expect(header("paid", "asc")).toContain('aria-sort="ascending"');
    expect(header("name", "asc")).toContain('aria-sort="none"');
  });
});
