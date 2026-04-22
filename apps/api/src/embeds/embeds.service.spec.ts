import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { EmbedsService } from "./embeds.service";
import { findProvider, OEMBED_PROVIDERS } from "./providers";

describe("findProvider", () => {
  test("matches a direct hostname", () => {
    expect(findProvider("https://codepen.io/foo/pen/abc")?.name).toBe("CodePen");
  });

  test("matches after stripping leading www.", () => {
    expect(findProvider("https://www.canva.com/design/xyz")?.name).toBe("Canva");
  });

  test("matches subdomains declared in the registry (open.spotify.com)", () => {
    expect(
      findProvider("https://open.spotify.com/track/abc")?.name,
    ).toBe("Spotify");
  });

  test("returns null for Twitter/X URLs (not in v1 registry)", () => {
    expect(findProvider("https://x.com/user/status/1")).toBeNull();
    expect(findProvider("https://twitter.com/user/status/1")).toBeNull();
  });

  test("returns null for an unknown host", () => {
    expect(findProvider("https://example.com/whatever")).toBeNull();
  });

  test("returns null for a suffix-style attacker host (canva.com.evil.com)", () => {
    expect(findProvider("https://canva.com.evil.com/foo")).toBeNull();
  });

  test("returns null for a malformed URL", () => {
    expect(findProvider("not a url")).toBeNull();
  });

  test("returns null for non-http(s) schemes", () => {
    expect(findProvider("javascript:alert(1)")).toBeNull();
    expect(findProvider("ftp://canva.com/x")).toBeNull();
  });
});

describe("EmbedsService.resolve", () => {
  let service: EmbedsService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    service = new EmbedsService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns null when no provider matches", async () => {
    const result = await service.resolve("https://example.com/whatever");
    expect(result).toBeNull();
  });

  test("returns sanitized iframe HTML for a valid provider response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          html:
            '<iframe src="https://codepen.io/anon/embed/abc" width="800" height="400"></iframe>',
          width: 800,
          height: 400,
          title: "A pen",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    expect(result).not.toBeNull();
    expect(result!.providerName).toBe("CodePen");
    expect(result!.html).toContain("<iframe");
    expect(result!.html).toContain("https://codepen.io/anon/embed/abc");
    expect(result!.width).toBe(800);
    expect(result!.height).toBe(400);
    expect(result!.title).toBe("A pen");
  });

  test("strips <script> tags from the provider response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          html:
            '<script>alert("xss")</script><iframe src="https://codepen.io/anon/embed/abc"></iframe>',
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("<script");
    expect(result!.html).not.toContain("alert(");
    expect(result!.html).toContain("<iframe");
  });

  test("rejects iframes whose src is not on the provider's allowlist", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          html: '<iframe src="https://attacker.example.com/pwn"></iframe>',
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    // sanitize-html drops the iframe whose host isn't in iframeHostnames,
    // leaving no iframe in the output → service returns null.
    expect(result).toBeNull();
  });

  test("strips dangerous attributes like onload and srcdoc", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          html:
            '<iframe src="https://codepen.io/anon/embed/abc" onload="alert(1)" srcdoc="<p>x</p>"></iframe>',
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("onload");
    expect(result!.html).not.toContain("srcdoc");
  });

  test("returns null when the provider response has no html", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ type: "video" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    expect(result).toBeNull();
  });

  test("returns null when the provider returns a non-2xx status", async () => {
    globalThis.fetch = mock(async () =>
      new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    expect(result).toBeNull();
  });

  test("returns null when the fetch throws", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;

    const result = await service.resolve("https://codepen.io/anon/pen/abc");
    expect(result).toBeNull();
  });

  test("caches successful lookups (second call does not hit fetch)", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response(
        JSON.stringify({
          html: '<iframe src="https://codepen.io/anon/embed/abc"></iframe>',
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await service.resolve("https://codepen.io/anon/pen/abc");
    await service.resolve("https://codepen.io/anon/pen/abc");
    expect(calls).toBe(1);
  });
});

describe("OEMBED_PROVIDERS registry", () => {
  test("includes Canva, Spotify, SoundCloud, CodePen, Vimeo", () => {
    const names = OEMBED_PROVIDERS.map((p) => p.name);
    expect(names).toContain("Canva");
    expect(names).toContain("Spotify");
    expect(names).toContain("SoundCloud");
    expect(names).toContain("CodePen");
    expect(names).toContain("Vimeo");
  });

  test("does not include Twitter (requires blockquote+script support)", () => {
    const names = OEMBED_PROVIDERS.map((p) => p.name);
    expect(names).not.toContain("Twitter");
  });

  test("every provider uses an https endpoint", () => {
    for (const p of OEMBED_PROVIDERS) {
      expect(p.endpoint.startsWith("https://")).toBe(true);
    }
  });
});
