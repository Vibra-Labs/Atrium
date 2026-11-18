import { describe, expect, it, mock } from "bun:test";
import { ArgumentsHost, BadRequestException, NotFoundException } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { ConfigService } from "@nestjs/config";
import { DemoEntryFilter } from "./demo-entry.filter";

const WEB_URL = "https://demo.atrium.test";

function build() {
  const response = {
    redirect: mock(() => {}),
    status: mock(() => response),
    json: mock(() => {}),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const config = { get: mock(() => WEB_URL) } as unknown as ConfigService;
  return { response, host, filter: new DemoEntryFilter(config) };
}

describe("DemoEntryFilter", () => {
  it("sends a rate-limited visitor to the unavailable page, not to raw JSON", () => {
    // Entry is a top-level form navigation, so the browser renders the
    // response body. A 429 used to paint a JSON error object over the only
    // door into the product.
    const { filter, host, response } = build();

    filter.catch(new ThrottlerException(), host);

    expect(response.redirect).toHaveBeenCalledWith(303, `${WEB_URL}/demo/unavailable`);
  });

  it("sends any other failure there too, including one it did not expect", () => {
    const { filter, host, response } = build();

    filter.catch(new Error("the seed is half-written"), host);

    expect(response.redirect).toHaveBeenCalledWith(303, `${WEB_URL}/demo/unavailable`);
  });

  it("redirects a bad kind rather than rendering the validation error", () => {
    const { filter, host, response } = build();

    filter.catch(new BadRequestException("Unknown demo kind"), host);

    expect(response.redirect).toHaveBeenCalledWith(303, `${WEB_URL}/demo/unavailable`);
  });

  it("leaves a 404 as a 404, so demo mode being off stays indistinguishable", () => {
    // An ordinary install must not advertise that this endpoint exists, and a
    // redirect to a demo page would do exactly that.
    const { filter, host, response } = build();

    filter.catch(new NotFoundException("Not found"), host);

    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
    // Shaped exactly like every other 404 the server returns. A body unique to
    // the demo would advertise the endpoint that the 404 exists to conceal.
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      message: "Not found",
      error: "Not Found",
    });
  });
});
