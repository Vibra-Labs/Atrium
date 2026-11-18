import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoBanner } from "./demo-banner";

describe("DemoBanner", () => {
  it("renders nothing outside the demo", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo={false} />)).toBe("");
  });

  it("counts down to the next reset, so nobody is surprised when their work vanishes", () => {
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />);
    expect(html).toMatch(/resets in (\d+ minutes?|under a minute)/);
  });

  it("offers no reset button", () => {
    // Several strangers share this workspace at once. A manual reset lets any
    // one of them wipe it out from under the others mid-click, and the
    // countdown already says when it happens on its own.
    const dashboard: string = renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />);
    const portal: string = renderToStaticMarkup(<DemoBanner surface="portal" isDemo />);
    expect(dashboard).not.toContain("Reset");
    expect(portal).not.toContain("Reset");
  });

  it("links Start free with ref=demo, so the demo's own conversions are attributable", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />)).toContain("ref=demo");
  });

  it("points Start free at the real app, since the demo runs on its own host", () => {
    const html: string = renderToStaticMarkup(
      <DemoBanner surface="dashboard" isDemo appUrl="https://atrium.vibralabs.co" />,
    );
    expect(html).toContain("https://atrium.vibralabs.co/signup?ref=demo");
  });

  it("offers the client view from the dashboard", () => {
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />);
    expect(html).toContain("/demo/client");
    expect(html).toContain("client view");
  });

  it("offers the way back from the portal, so the flip works both ways", () => {
    // A visitor who lands in the portal is one click from the agency side.
    // Without this the client view was a dead end you had to know to leave.
    const html: string = renderToStaticMarkup(<DemoBanner surface="portal" isDemo />);
    expect(html).toContain('href="/demo"');
    expect(html).toContain("agency view");
    expect(html).not.toContain("/demo/client");
  });


});
