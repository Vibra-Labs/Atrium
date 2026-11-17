import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TelemetryConsentBanner } from "./telemetry-consent-banner";

describe("TelemetryConsentBanner", () => {
  it("asks an ordinary workspace about crash reports", () => {
    expect(renderToStaticMarkup(<TelemetryConsentBanner />)).toContain("Help improve Atrium");
  });

  it("never asks a demo visitor", () => {
    // Two reasons. It is someone else's workspace, so the consent is not
    // theirs to give — and both buttons PATCH /settings, which the demo
    // refuses, so clicking either returns 403 and the banner never dismisses.
    expect(renderToStaticMarkup(<TelemetryConsentBanner isDemo />)).toBe("");
  });
});
