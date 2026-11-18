import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoBanner } from "./demo-banner";

describe("DemoBanner", () => {
  it("renders nothing outside the demo", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo={false} />)).toBe("");
  });

  it("says the cadence before the clock is read, so the two renders agree", () => {
    // The countdown depends on the current time, so computing it as initial
    // state renders one value on the server and another at hydration, and
    // React logs a mismatch warning on every demo page. This phrase is true at
    // any time; the live countdown replaces it on mount, and demo.e2e.ts
    // asserts that it does.
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />);
    expect(html).toContain("resets every 30 minutes");
    expect(html).not.toMatch(/resets in /);
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
    const html: string = renderToStaticMarkup(
      <DemoBanner surface="dashboard" isDemo appUrl="https://atrium.vibralabs.co" />,
    );
    expect(html).toContain("ref=demo");
  });

  it("offers no Start free at all when it has no real app to point at", () => {
    // With DEMO_APP_URL unset the href resolved to /signup on the demo host
    // itself: the visitor signs up on a throwaway instance, runs the setup
    // wizard, and books real Google Ads conversions from it. No button is
    // better than a button that sends people to the wrong place.
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />);
    expect(html).not.toContain("Start free");
    expect(html).not.toContain("/signup");
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
