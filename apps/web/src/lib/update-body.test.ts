import { describe, expect, it } from "bun:test";
import { updateBody } from "./update-body";

describe("updateBody", () => {
  it("sends JSON when there is no attachment", () => {
    // A multipart request with no file in it reads as an upload to anything
    // deciding by content type — the demo's upload fence turned the ordinary
    // act of posting a text update into "Uploads are turned off in the demo."
    const body = updateBody("Shipped the new homepage", null);

    expect(body).toBe(JSON.stringify({ content: "Shipped the new homepage" }));
  });

  it("sends multipart when there is a file to carry", () => {
    const file = new File(["png"], "mock.png", { type: "image/png" });

    const body = updateBody("With a screenshot", file);

    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("content")).toBe("With a screenshot");
    expect((form.get("attachment") as File).name).toBe("mock.png");
  });
});
