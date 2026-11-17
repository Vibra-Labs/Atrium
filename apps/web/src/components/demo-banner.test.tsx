import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoBanner } from "./demo-banner";

describe("DemoBanner", () => {
  it("renders nothing outside the demo", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo={false} />)).toBe("");
  });

  it("names the reset cadence, so nobody is surprised when their work vanishes", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />)).toContain("30 minutes");
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

  it("offers the client view on the dashboard only", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />)).toContain("/demo/client");
    expect(renderToStaticMarkup(<DemoBanner surface="portal" isDemo />)).not.toContain("/demo/client");
  });

  it("offers a reset", () => {
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" isDemo />)).toContain("Reset");
  });
});
