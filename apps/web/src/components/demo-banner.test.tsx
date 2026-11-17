import { describe, expect, it, afterEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoBanner } from "./demo-banner";

const original: string | undefined = process.env.NEXT_PUBLIC_DEMO_MODE;
const originalAppUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = original;
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("DemoBanner", () => {
  it("renders nothing outside the demo", () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" />)).toBe("");
  });

  it("names the reset cadence, so nobody is surprised when their work vanishes", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" />);
    expect(html).toContain("30 minutes");
  });

  it("links Start free with ref=demo, so the demo's own conversions are attributable", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" />);
    expect(html).toContain("ref=demo");
  });

  it("points Start free at the real app, since the demo runs on its own host", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    process.env.NEXT_PUBLIC_APP_URL = "https://atrium.vibralabs.co";
    const html: string = renderToStaticMarkup(<DemoBanner surface="dashboard" />);
    expect(html).toContain("https://atrium.vibralabs.co/signup?ref=demo");
  });

  it("offers the client view on the dashboard only", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" />)).toContain("/demo/client");
    expect(renderToStaticMarkup(<DemoBanner surface="portal" />)).not.toContain("/demo/client");
  });

  it("offers a reset", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    expect(renderToStaticMarkup(<DemoBanner surface="dashboard" />)).toContain("Reset");
  });
});
