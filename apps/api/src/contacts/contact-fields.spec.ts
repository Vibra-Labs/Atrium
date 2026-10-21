import { describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import {
  NAME_PART_MAX,
  createNames,
  importSocialLinks,
  normalizeSocialLink,
  normalizeSocialLinks,
  phonesOf,
  optionalText,
  parseRating,
  readPhones,
  resolvePhones,
  splitName,
  updateNames,
} from "./contact-fields";

function throws400(fn: () => unknown, message?: string): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(BadRequestException);
  if (message) expect((err as Error).message).toBe(message);
}

describe("splitName", () => {
  it("splits on the first whitespace", () => {
    expect(splitName("  Ann  Marie Lee ")).toEqual({ firstName: "Ann", lastName: "Marie Lee" });
  });

  it("single word has no last name", () => {
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: null });
  });

  it("blank gives no first name", () => {
    expect(splitName("   ")).toEqual({ firstName: null, lastName: null });
  });
});

describe("createNames", () => {
  it("first + last builds the name", () => {
    expect(createNames({ firstName: " Ann ", lastName: " Lee " })).toEqual({
      name: "Ann Lee",
      firstName: "Ann",
      lastName: "Lee",
    });
  });

  it("first only", () => {
    expect(createNames({ firstName: "Ann" })).toEqual({ name: "Ann", firstName: "Ann", lastName: null });
  });

  it("first wins over name", () => {
    expect(createNames({ name: "Someone Else", firstName: "Ann", lastName: "Lee" }).name).toBe("Ann Lee");
  });

  it("longest first + last fit the 200-char name", () => {
    const first = "a".repeat(NAME_PART_MAX);
    const last = "b".repeat(NAME_PART_MAX);
    expect(createNames({ firstName: first, lastName: last }).name.length).toBeLessThanOrEqual(200);
  });

  it("a blank first name falls back to the name", () => {
    expect(createNames({ name: "Ann Lee", firstName: " " }).firstName).toBe("Ann");
  });

  it("name only is split", () => {
    expect(createNames({ name: " Ann Marie Lee " })).toEqual({
      name: "Ann Marie Lee",
      firstName: "Ann",
      lastName: "Marie Lee",
    });
  });

  it("single-word name", () => {
    expect(createNames({ name: "Cher" })).toEqual({ name: "Cher", firstName: "Cher", lastName: null });
  });

  it("no first name or name is 400 'Name is required'", () => {
    throws400(() => createNames({}), "Name is required");
    throws400(() => createNames({ name: "  " }), "Name is required");
    throws400(() => createNames({ firstName: " ", lastName: "Lee" }), "Name is required");
  });
});

describe("updateNames", () => {
  const stored = { name: "Ann Lee", firstName: "Ann", lastName: "Lee" };

  it("nothing given changes nothing", () => {
    expect(updateNames({}, stored)).toEqual({});
  });

  it("first name only merges with the stored last name", () => {
    expect(updateNames({ firstName: "Anna" }, stored)).toEqual({
      name: "Anna Lee",
      firstName: "Anna",
      lastName: "Lee",
    });
  });

  it("last name only merges with the stored first name", () => {
    expect(updateNames({ lastName: "Park" }, stored)).toEqual({
      name: "Ann Park",
      firstName: "Ann",
      lastName: "Park",
    });
  });

  it("clearing the last name (null or blank)", () => {
    expect(updateNames({ lastName: null }, stored)).toEqual({ name: "Ann", firstName: "Ann", lastName: null });
    expect(updateNames({ lastName: " " }, stored)).toEqual({ name: "Ann", firstName: "Ann", lastName: null });
  });

  it("first name cannot be emptied", () => {
    throws400(() => updateNames({ firstName: "" }, stored), "Name is required");
    throws400(() => updateNames({ firstName: null }, stored), "Name is required");
  });

  it("name only is re-split", () => {
    expect(updateNames({ name: "Bo Diddley" }, stored)).toEqual({
      name: "Bo Diddley",
      firstName: "Bo",
      lastName: "Diddley",
    });
    throws400(() => updateNames({ name: " " }, stored), "Name is required");
  });

  it("falls back to splitting the stored name when firstName was never set", () => {
    expect(updateNames({ lastName: "Park" }, { name: "Ann Lee", firstName: null, lastName: null })).toEqual({
      name: "Ann Park",
      firstName: "Ann",
      lastName: "Park",
    });
  });
});

describe("resolvePhones", () => {
  const two = [
    { label: "Mobile", number: "111" },
    { label: "Work", number: "222" },
  ];

  it("nothing given changes nothing", () => {
    expect(resolvePhones({}, two)).toEqual({});
  });

  it("phones are trimmed and mirrored into phone", () => {
    expect(resolvePhones({ phones: [{ label: " Work ", number: " 555 " }] }, [])).toEqual({
      phones: [{ label: "Work", number: "555" }],
      phone: "555",
    });
  });

  it("empty phones clears phone", () => {
    expect(resolvePhones({ phones: [] }, two)).toEqual({ phones: [], phone: null });
    expect(resolvePhones({ phones: null }, two)).toEqual({ phones: [], phone: null });
  });

  it("phones wins over legacy phone", () => {
    expect(resolvePhones({ phones: [{ label: "Home", number: "9" }], phone: "1" }, []).phone).toBe("9");
  });

  it("validates labels and numbers after trimming", () => {
    throws400(() => resolvePhones({ phones: [{ label: " ", number: "1" }] }, []));
    throws400(() => resolvePhones({ phones: [{ label: "x".repeat(31), number: "1" }] }, []));
    throws400(() => resolvePhones({ phones: [{ label: "Work", number: "  " }] }, []));
    throws400(() => resolvePhones({ phones: [{ label: "Work", number: "1".repeat(51) }] }, []));
    const eleven = Array.from({ length: 11 }, (_, i) => ({ label: "W", number: String(i) }));
    throws400(() => resolvePhones({ phones: eleven }, []));
  });

  it("legacy phone with no stored phones adds a 'Phone' entry", () => {
    expect(resolvePhones({ phone: " 555 " }, [])).toEqual({
      phones: [{ label: "Phone", number: "555" }],
      phone: "555",
    });
  });

  it("legacy phone replaces the first number, keeping its label", () => {
    expect(resolvePhones({ phone: "999" }, two)).toEqual({
      phones: [
        { label: "Mobile", number: "999" },
        { label: "Work", number: "222" },
      ],
      phone: "999",
    });
  });

  it("legacy phone null or blank removes the first number", () => {
    expect(resolvePhones({ phone: null }, two)).toEqual({ phones: [two[1]], phone: "222" });
    expect(resolvePhones({ phone: "" }, [two[0]])).toEqual({ phones: [], phone: null });
  });
});

describe("readPhones", () => {
  it("keeps only well-formed entries", () => {
    expect(readPhones([{ label: "A", number: "1" }, { label: 1 }, "x", null])).toEqual([{ label: "A", number: "1" }]);
    expect(readPhones(null)).toEqual([]);
    expect(readPhones({})).toEqual([]);
  });
});

describe("normalizeSocialLinks", () => {
  it("trims and de-duplicates", () => {
    expect(
      normalizeSocialLinks([" https://linkedin.com/in/ann ", "https://linkedin.com/in/ann", "http://x.com/ann"]),
    ).toEqual(["https://linkedin.com/in/ann", "http://x.com/ann"]);
  });

  it("drops blanks", () => {
    expect(normalizeSocialLinks(["", "  "])).toEqual([]);
    expect(normalizeSocialLinks(null)).toEqual([]);
  });

  it("rejects non-http(s), unparseable and over-long links", () => {
    throws400(() => normalizeSocialLinks(["javascript:alert(1)"]));
    throws400(() => normalizeSocialLinks(["ftp://x.com"]));
    throws400(() => normalizeSocialLinks(["acme"]));
    throws400(() => normalizeSocialLinks(["localhost:3000/x"]));
    throws400(() => normalizeSocialLinks([`https://x.com/${"a".repeat(500)}`]));
  });

  it("gives a bare domain https:// (API, MCP and Zapier inputs alike)", () => {
    expect(normalizeSocialLinks(["linkedin.com/in/ann", "https://linkedin.com/in/ann"])).toEqual([
      "https://linkedin.com/in/ann",
    ]);
    expect(normalizeSocialLink(" www.ann.dev ")).toBe("https://www.ann.dev");
    expect(normalizeSocialLink("javascript:alert(1)")).toBeNull();
    expect(normalizeSocialLink("mailto:a@b.com")).toBeNull();
    expect(normalizeSocialLink("acme")).toBeNull();
  });

  it("allows at most 10", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://x.com/${i}`);
    throws400(() => normalizeSocialLinks(eleven));
    expect(normalizeSocialLinks(eleven.slice(0, 10))).toHaveLength(10);
  });
});

describe("importSocialLinks", () => {
  it("turns handles under a Twitter or X header into x.com links", () => {
    expect(
      importSocialLinks([
        { header: "Twitter", value: "@acme" },
        { header: "X", value: "beta_co" },
      ]),
    ).toEqual({ links: ["https://x.com/acme", "https://x.com/beta_co"], dropped: [] });
  });

  it("keeps full links under a Twitter header and doesn't treat handles elsewhere as x.com", () => {
    expect(importSocialLinks([{ header: "Twitter", value: "https://twitter.com/acme" }]).links).toEqual([
      "https://twitter.com/acme",
    ]);
    expect(importSocialLinks([{ header: "Social", value: "@acme" }])).toEqual({ links: [], dropped: ["@acme"] });
  });

  it("prefixes bare domains, splits cells, de-duplicates, drops what isn't a link", () => {
    expect(
      importSocialLinks([
        { header: "LinkedIn", value: "linkedin.com/in/ann; https://linkedin.com/in/ann, javascript:alert(1)" },
        { header: "Social", value: "ann.dev nope" },
      ]),
    ).toEqual({
      links: ["https://linkedin.com/in/ann", "https://ann.dev"],
      dropped: ["javascript:alert(1)", "nope"],
    });
  });

  it("keeps at most 10", () => {
    const value = Array.from({ length: 12 }, (_, i) => `https://x.com/${i}`).join(" ");
    expect(importSocialLinks([{ header: "Social", value }]).links).toHaveLength(10);
  });
});

describe("phonesOf", () => {
  it("falls back to the legacy phone while phones is empty", () => {
    expect(phonesOf([], " 555 ")).toEqual([{ label: "Phone", number: "555" }]);
    expect(phonesOf([], null)).toEqual([]);
    expect(phonesOf([{ label: "Work", number: "1" }], "1")).toEqual([{ label: "Work", number: "1" }]);
  });
});

describe("parseRating", () => {
  it("is case-insensitive; blank is undefined; unknown is null", () => {
    expect(parseRating(" HOT ")).toBe("hot");
    expect(parseRating("Warm")).toBe("warm");
    expect(parseRating("")).toBeUndefined();
    expect(parseRating("lukewarm")).toBeNull();
  });
});

describe("optionalText", () => {
  it("undefined leaves alone, blank/null clears, else trims", () => {
    expect(optionalText(undefined)).toBeUndefined();
    expect(optionalText(null)).toBeNull();
    expect(optionalText("  ")).toBeNull();
    expect(optionalText(" CTO ")).toBe("CTO");
  });
});
