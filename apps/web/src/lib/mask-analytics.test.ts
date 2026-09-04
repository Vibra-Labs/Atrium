import { describe, expect, it } from "bun:test";
import { maskAnalyticsEvent } from "./mask-analytics";

describe("maskAnalyticsEvent", () => {
  it("replaces cuid project ids", () => {
    expect(
      maskAnalyticsEvent("pageview", {
        url: "/portal/projects/cmpy4tm44008nth2n02xhsgtu",
      }).url,
    ).toBe("/portal/projects/[id]");
  });

  it("replaces uuids", () => {
    expect(
      maskAnalyticsEvent("pageview", {
        url: "/dashboard/projects/85b1a5bd-7983-4502-8530-f4b2923de8ef",
      }).url,
    ).toBe("/dashboard/projects/[id]");
  });

  it("replaces branded login org slugs", () => {
    expect(
      maskAnalyticsEvent("pageview", { url: "/login/it-selucky-nt6w9q" }).url,
    ).toBe("/login/[slug]");
  });

  it("replaces signing tokens", () => {
    expect(
      maskAnalyticsEvent("pageview", { url: "/portal/sign/abc123def456xyz" }).url,
    ).toBe("/portal/sign/[token]");
  });

  it("drops the query string, which carries task and invitation ids", () => {
    expect(
      maskAnalyticsEvent("pageview", {
        url: "/portal/projects?task=cmr0uizxu00ixth2nfghujzch",
      }).url,
    ).toBe("/portal/projects");
  });

  it("drops the page title", () => {
    expect(
      maskAnalyticsEvent("pageview", {
        url: "/portal",
        title: "Acme Corp Rebrand | Atrium",
      }).title,
    ).toBeUndefined();
  });

  it("leaves plain routes untouched", () => {
    expect(maskAnalyticsEvent("pageview", { url: "/dashboard/clients" }).url).toBe(
      "/dashboard/clients",
    );
  });

  it("keeps non-identifying event data", () => {
    const out = maskAnalyticsEvent("event", {
      url: "/portal/projects/cmpy4tm44008nth2n02xhsgtu",
      name: "portal_file_downloaded",
      data: { type: "pdf" },
    });
    expect(out.name).toBe("portal_file_downloaded");
    expect(out.data).toEqual({ type: "pdf" });
    expect(out.url).toBe("/portal/projects/[id]");
  });

  it("survives a malformed payload without throwing", () => {
    expect(() => maskAnalyticsEvent("event", {})).not.toThrow();
  });

  it("stays self-contained so it can be serialised into the page", () => {
    const src: string = maskAnalyticsEvent.toString();
    expect(src.startsWith("function")).toBe(true);
    // A closure reference would break once inlined into the browser.
    expect(src).not.toContain("import");
  });
});
