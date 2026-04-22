import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { UnfurlService, parseMeta } from "./unfurl.service";

describe("parseMeta", () => {
  test("extracts Open Graph tags", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="The Title">
        <meta property="og:description" content="A description">
        <meta property="og:image" content="https://example.com/img.png">
        <meta property="og:site_name" content="Example Site">
      </head></html>
    `;
    const meta = parseMeta(html, "https://example.com/page");
    expect(meta.title).toBe("The Title");
    expect(meta.description).toBe("A description");
    expect(meta.image).toBe("https://example.com/img.png");
    expect(meta.siteName).toBe("Example Site");
  });

  test("falls back to Twitter Card tags when OG is missing", () => {
    const html = `
      <head>
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter desc">
        <meta name="twitter:image" content="https://example.com/tw.png">
      </head>
    `;
    const meta = parseMeta(html, "https://example.com/");
    expect(meta.title).toBe("Twitter Title");
    expect(meta.description).toBe("Twitter desc");
    expect(meta.image).toBe("https://example.com/tw.png");
  });

  test("falls back to <title> tag when no meta tags are present", () => {
    const html = `<head><title>Page Title</title></head>`;
    const meta = parseMeta(html, "https://example.com/");
    expect(meta.title).toBe("Page Title");
  });

  test("prefers og:description over meta name=description", () => {
    const html = `
      <head>
        <meta name="description" content="plain">
        <meta property="og:description" content="og">
      </head>
    `;
    expect(parseMeta(html, "https://x.com/").description).toBe("og");
  });

  test("absolutizes relative image URLs against the final URL", () => {
    const html = `<head><meta property="og:image" content="/img/pic.jpg"></head>`;
    const meta = parseMeta(html, "https://example.com/posts/1");
    expect(meta.image).toBe("https://example.com/img/pic.jpg");
  });

  test("absolutizes favicon from <link rel=icon>", () => {
    const html = `<head><link rel="icon" href="/favicon.ico"></head>`;
    const meta = parseMeta(html, "https://example.com/page");
    expect(meta.favicon).toBe("https://example.com/favicon.ico");
  });

  test("absolutizes favicon from <link rel=\"shortcut icon\">", () => {
    const html = `<head><link rel="shortcut icon" href="fav.png"></head>`;
    const meta = parseMeta(html, "https://example.com/a/b");
    expect(meta.favicon).toBe("https://example.com/a/fav.png");
  });

  test("decodes HTML entities in meta content", () => {
    const html = `<meta property="og:title" content="A &amp; B &lt;C&gt;">`;
    expect(parseMeta(html, "https://x.com/").title).toBe("A & B <C>");
  });

  test("returns undefined fields when nothing is present", () => {
    const meta = parseMeta("<html><body>no head</body></html>", "https://x.com/");
    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.image).toBeUndefined();
  });

  test("tolerates swapped attribute order (content before property)", () => {
    const html = `<meta content="Swapped" property="og:title">`;
    expect(parseMeta(html, "https://x.com/").title).toBe("Swapped");
  });

  test("caps head scan at 256KB so huge docs don't blow up CPU", () => {
    // Pad with non-meta content, then place the meta tag beyond the cap.
    const padding = "x".repeat(260 * 1024);
    const html = `<head>${padding}<meta property="og:title" content="Hidden"></head>`;
    expect(parseMeta(html, "https://x.com/").title).toBeUndefined();
  });
});

describe("UnfurlService.unfurl", () => {
  let service: UnfurlService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    service = new UnfurlService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns null when the response has no meta at all", async () => {
    globalThis.fetch = mock(async () =>
      new Response("<html><body>nothing here</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    // Point at a public-looking hostname that still resolves (example.com does).
    const result = await service.unfurl("https://example.com/empty");
    expect(result).toBeNull();
  });

  test("returns null on SSRF-blocked hosts (localhost)", async () => {
    // safeFetch rejects loopback before any network I/O.
    const result = await service.unfurl("https://127.0.0.1/");
    expect(result).toBeNull();
  });

  test("returns null for non-https URLs", async () => {
    const result = await service.unfurl("http://example.com/");
    expect(result).toBeNull();
  });

  test("caches null results (second call does not re-fetch)", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response("<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as typeof fetch;

    await service.unfurl("https://example.com/a");
    await service.unfurl("https://example.com/a");
    expect(calls).toBe(1);
  });
});
