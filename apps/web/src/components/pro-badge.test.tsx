import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UpgradeLink } from "./pro-badge";

describe("UpgradeLink", () => {
  it("sends people to the billing page, which is where the plans and the reason banner live", () => {
    const html: string = renderToStaticMarkup(<UpgradeLink reason="e-signatures" />);
    expect(html).toContain('href="/dashboard/settings/billing?reason=e-signatures"');
  });
});
