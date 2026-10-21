import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportReview, checkSummary, sampleDetails } from "./import-review";
import type { ImportCheck, ImportSample } from "./import-review";

const sample: ImportSample = {
  row: 2,
  name: "Ann Lee",
  email: "ann@x.com",
  company: "Acme",
  phones: [
    { label: "Mobile", number: "+1 555 0100" },
    { label: "Work", number: "+1 555 0200" },
  ],
  status: "client",
  rating: "hot",
  tags: ["vip", "expo"],
  followUpAt: "2026-11-05",
  referredBy: "Bo",
};

describe("checkSummary", () => {
  it("counts what will be created, skipped and left out", () => {
    const check: ImportCheck = {
      total: 4,
      toCreate: 3,
      skipped: [{ row: 3, reason: "Missing name" }],
      warnings: [{ row: 2, reason: "x" }],
      sample: [],
    };
    expect(checkSummary(check)).toBe("3 contacts will be created · 1 row skipped · 1 warning");
    expect(checkSummary({ ...check, toCreate: 1, skipped: [], warnings: [] })).toBe("1 contact will be created");
  });
});

describe("sampleDetails", () => {
  it("lists status, rating, tags, follow-up and referrer", () => {
    expect(sampleDetails(sample)).toBe("Client · Hot · vip, expo · Follow up 2026-11-05 · Referred by Bo");
    expect(sampleDetails({ ...sample, rating: null, tags: [], followUpAt: null, referredBy: null })).toBe("Client");
  });
});

describe("ImportReview", () => {
  it("shows each sample contact with every phone and its label, plus skipped rows", () => {
    const html: string = renderToStaticMarkup(
      <ImportReview
        check={{ total: 2, toCreate: 1, skipped: [{ row: 3, reason: "Invalid email" }], warnings: [], sample: [sample] }}
      />,
    );
    expect(html).toContain("Ann Lee");
    expect(html).toContain("Mobile:</span> +1 555 0100");
    expect(html).toContain("Work:</span> +1 555 0200");
    expect(html).toContain("<li>Row 3: Invalid email</li>");
    expect(html).not.toContain("left out");
  });
});
