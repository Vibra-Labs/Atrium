import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhonesField, SocialLinksField, cleanLinks, cleanPhones } from "./contact-fields";

describe("repeater fields", () => {
  it("remove buttons are named by their label; the X icon is hidden from screen readers", () => {
    const html: string =
      renderToStaticMarkup(
        <PhonesField idPrefix="t" phones={[{ label: "Work", number: "1" }]} onChange={() => {}} />,
      ) + renderToStaticMarkup(<SocialLinksField links={["https://x.com/a"]} onChange={() => {}} />);
    expect(html).toContain('aria-label="Remove phone 1"');
    expect(html).toContain('aria-label="Remove link 1"');
    const icons = html.match(/<svg[^>]*>/g) ?? [];
    expect(icons).toHaveLength(2);
    for (const svg of icons) expect(svg).toContain('aria-hidden="true"');
  });
});

describe("cleanPhones / cleanLinks", () => {
  it("drop blank rows, default the label and prefix bare domains", () => {
    expect(cleanPhones([{ label: " ", number: " 5 " }, { label: "Work", number: "" }])).toEqual([
      { label: "Mobile", number: "5" },
    ]);
    expect(cleanLinks([" linkedin.com/in/a ", "", "https://x.com/a"])).toEqual([
      "https://linkedin.com/in/a",
      "https://x.com/a",
    ]);
  });
});
