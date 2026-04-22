import { describe, test, expect } from "bun:test";
import {
  getEmbeds,
  extractOEmbedCandidates,
  applyPrefPatch,
  nextSize,
  type PreviewPrefs,
} from "./embeds";

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

describe("getEmbeds — YouTube", () => {
  test("extracts a standard watch?v= URL and returns the correct embed URL", () => {
    const text = "Check this out: https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("youtube");
    expect(embeds[0].originalUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(embeds[0].embedUrl).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  test("extracts a youtu.be short URL and returns the correct embed URL", () => {
    const text = "Short link: https://youtu.be/dQw4w9WgXcQ";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("youtube");
    expect(embeds[0].embedUrl).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    );
  });

  test("extracts a YouTube URL without www subdomain", () => {
    const text = "https://youtube.com/watch?v=abc123def45";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("youtube");
    expect(embeds[0].embedUrl).toBe(
      "https://www.youtube.com/embed/abc123def45",
    );
  });

  test("extracts the video id when additional query params precede the v= param", () => {
    // URL: watch?feature=share&v=abc123def45
    const text =
      "https://www.youtube.com/watch?feature=share&v=abc123def45";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].embedUrl).toBe(
      "https://www.youtube.com/embed/abc123def45",
    );
  });
});

// ---------------------------------------------------------------------------
// Loom
// ---------------------------------------------------------------------------

describe("getEmbeds — Loom", () => {
  test("extracts a loom.com/share URL and returns the correct embed URL", () => {
    const text = "Watch the recording: https://www.loom.com/share/abc123def456";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("loom");
    expect(embeds[0].originalUrl).toBe(
      "https://www.loom.com/share/abc123def456",
    );
    expect(embeds[0].embedUrl).toBe(
      "https://www.loom.com/embed/abc123def456",
    );
  });

  test("extracts a Loom URL without www subdomain", () => {
    const text = "https://loom.com/share/xyz987ghi";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("loom");
    expect(embeds[0].embedUrl).toBe("https://www.loom.com/embed/xyz987ghi");
  });
});

// ---------------------------------------------------------------------------
// Figma
// ---------------------------------------------------------------------------

describe("getEmbeds — Figma", () => {
  test("extracts a figma.com/file URL and returns a correctly encoded embed URL", () => {
    const original =
      "https://www.figma.com/file/aBcDeFgH1234/My-Design?node-id=0%3A1";
    const text = `Design link: ${original}`;
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("figma");
    expect(embeds[0].embedUrl).toContain(
      "https://www.figma.com/embed?embed_host=share&url=",
    );
    expect(embeds[0].embedUrl).toContain(encodeURIComponent(original));
  });

  test("extracts a figma.com/design URL and returns a correctly encoded embed URL", () => {
    const original =
      "https://www.figma.com/design/XyZ1234abc/Dashboard-Redesign";
    const text = `See the design: ${original}`;
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("figma");
    expect(embeds[0].embedUrl).toContain(
      "https://www.figma.com/embed?embed_host=share&url=",
    );
    expect(embeds[0].embedUrl).toContain(encodeURIComponent(original));
  });

  test("preserves the originalUrl as the matched Figma URL (not the embed URL)", () => {
    const original = "https://www.figma.com/file/abc123/Prototype";
    const embeds = getEmbeds(original);

    expect(embeds[0].originalUrl).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Google Docs / Sheets / Slides
// ---------------------------------------------------------------------------

describe("getEmbeds — Google Docs suite", () => {
  test("extracts a Google Docs URL and returns the correct /preview embed URL", () => {
    const text =
      "Spec: https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("google-docs");
    expect(embeds[0].embedUrl).toBe(
      "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/preview",
    );
  });

  test("extracts a Google Sheets URL and returns the correct /preview embed URL", () => {
    const text =
      "Budget: https://docs.google.com/spreadsheets/d/1SmPo7KiYS7hn-Rn0a5BpHjkdQ3";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("google-docs");
    expect(embeds[0].embedUrl).toBe(
      "https://docs.google.com/spreadsheets/d/1SmPo7KiYS7hn-Rn0a5BpHjkdQ3/preview",
    );
  });

  test("extracts a Google Slides URL and returns the correct /preview embed URL", () => {
    const text =
      "Deck: https://docs.google.com/presentation/d/1ABCxyz987654321";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
    expect(embeds[0].provider).toBe("google-docs");
    expect(embeds[0].embedUrl).toBe(
      "https://docs.google.com/presentation/d/1ABCxyz987654321/preview",
    );
  });

  test("preserves the originalUrl as the matched Google Docs URL", () => {
    const original =
      "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms";
    const embeds = getEmbeds(original);

    expect(embeds[0].originalUrl).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe("getEmbeds — deduplication", () => {
  test("returns one embed when the same YouTube URL appears twice in the text", () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const text = `${url} and again: ${url}`;
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
  });

  test("returns one embed when the same Loom URL appears twice in the text", () => {
    const url = "https://www.loom.com/share/abc123def456";
    const text = `${url} — repeated: ${url}`;
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(1);
  });

  test("returns two embeds when two different YouTube video IDs appear", () => {
    const text =
      "https://www.youtube.com/watch?v=video00001 and https://www.youtube.com/watch?v=video00002";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(2);
    expect(embeds[0].embedUrl).toContain("video00001");
    expect(embeds[1].embedUrl).toContain("video00002");
  });
});

// ---------------------------------------------------------------------------
// MAX_EMBEDS cap (3)
// ---------------------------------------------------------------------------

describe("getEmbeds — MAX_EMBEDS cap", () => {
  test("returns at most 3 embeds when 4 different embeddable URLs are present", () => {
    const text = [
      "https://www.youtube.com/watch?v=video00001",
      "https://www.youtube.com/watch?v=video00002",
      "https://www.youtube.com/watch?v=video00003",
      "https://www.youtube.com/watch?v=video00004",
    ].join(" ");

    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(3);
  });

  test("returns at most 3 embeds when 4 URLs from different providers are present", () => {
    const text = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.loom.com/share/abc123",
      "https://www.figma.com/file/XYZ123/Design",
      "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
    ].join(" ");

    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(3);
  });

  test("returns exactly 3 embeds when exactly 3 URLs are present", () => {
    const text = [
      "https://www.youtube.com/watch?v=video00001",
      "https://www.youtube.com/watch?v=video00002",
      "https://www.youtube.com/watch?v=video00003",
    ].join(" ");

    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// No embeddable URLs
// ---------------------------------------------------------------------------

describe("getEmbeds — no embeddable URLs", () => {
  test("returns an empty array for plain text with no URLs", () => {
    const embeds = getEmbeds("Just a plain text update with no links.");

    expect(embeds).toHaveLength(0);
  });

  test("returns an empty array for an empty string", () => {
    const embeds = getEmbeds("");

    expect(embeds).toHaveLength(0);
  });

  test("returns an empty array when text contains non-embeddable URLs", () => {
    const text =
      "Visit https://example.com and https://github.com/user/repo for more info.";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple providers in one text
// ---------------------------------------------------------------------------

describe("getEmbeds — multiple providers", () => {
  test("extracts one embed per unique provider when two different providers appear", () => {
    const text =
      "Video: https://www.youtube.com/watch?v=dQw4w9WgXcQ Recording: https://www.loom.com/share/abc123";
    const embeds = getEmbeds(text);

    expect(embeds).toHaveLength(2);
    const providers = embeds.map((e) => e.provider);
    expect(providers).toContain("youtube");
    expect(providers).toContain("loom");
  });

  test("processes YouTube URLs before Loom URLs in the returned array (provider order)", () => {
    // YouTube is processed first in getEmbeds, so it should appear first
    const text =
      "https://www.loom.com/share/first123 https://www.youtube.com/watch?v=second456";
    const embeds = getEmbeds(text);

    // YouTube regex runs first — its result appears before Loom even though Loom URL comes first in the text
    const youtubeIdx = embeds.findIndex((e) => e.provider === "youtube");
    const loomIdx = embeds.findIndex((e) => e.provider === "loom");
    expect(youtubeIdx).toBeLessThan(loomIdx);
  });
});

// ---------------------------------------------------------------------------
// lastIndex reset (calling getEmbeds twice in a row works correctly)
// ---------------------------------------------------------------------------

describe("getEmbeds — stateless across multiple calls", () => {
  test("calling getEmbeds twice with the same input returns the same results both times", () => {
    const text =
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    const first = getEmbeds(text);
    const second = getEmbeds(text);

    expect(second).toHaveLength(first.length);
    expect(second[0].embedUrl).toBe(first[0].embedUrl);
  });

  test("calling getEmbeds twice in a row with different inputs returns independent results", () => {
    const textA = "https://www.youtube.com/watch?v=videoAAAA";
    const textB = "https://www.youtube.com/watch?v=videoBBBB";

    const resultA = getEmbeds(textA);
    const resultB = getEmbeds(textB);

    expect(resultA[0].embedUrl).toContain("videoAAAA");
    expect(resultB[0].embedUrl).toContain("videoBBBB");
  });

  test("calling getEmbeds on a text with no URLs after one with URLs returns empty array", () => {
    getEmbeds("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const second = getEmbeds("No URLs here at all.");

    expect(second).toHaveLength(0);
  });

  test("calling getEmbeds multiple times in succession does not accumulate embeds", () => {
    const text = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    getEmbeds(text);
    getEmbeds(text);
    const third = getEmbeds(text);

    expect(third).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractOEmbedCandidates
// ---------------------------------------------------------------------------

describe("applyPrefPatch", () => {
  test("creates an entry for a URL not yet in prefs", () => {
    const prefs: PreviewPrefs = {};
    const next = applyPrefPatch(prefs, "https://x.com/", { size: "compact" });
    expect(next["https://x.com/"]).toEqual({ size: "compact" });
  });

  test("merges fields with an existing entry instead of replacing", () => {
    const prefs: PreviewPrefs = { "https://x.com/": { size: "full" } };
    const next = applyPrefPatch(prefs, "https://x.com/", { hidden: true });
    expect(next["https://x.com/"]).toEqual({ size: "full", hidden: true });
  });

  test("overwrites a key when the patch supplies the same field", () => {
    const prefs: PreviewPrefs = { "https://x.com/": { size: "full" } };
    const next = applyPrefPatch(prefs, "https://x.com/", { size: "compact" });
    expect(next["https://x.com/"].size).toBe("compact");
  });

  test("does not mutate the input prefs object", () => {
    const prefs: PreviewPrefs = { "https://x.com/": { size: "full" } };
    applyPrefPatch(prefs, "https://x.com/", { hidden: true });
    expect(prefs["https://x.com/"]).toEqual({ size: "full" });
  });

  test("does not mutate the per-URL entry object", () => {
    const entry = { size: "full" as const };
    const prefs: PreviewPrefs = { "https://x.com/": entry };
    applyPrefPatch(prefs, "https://x.com/", { hidden: true });
    expect(entry).toEqual({ size: "full" });
  });

  test("preserves other URLs unchanged", () => {
    const prefs: PreviewPrefs = {
      "https://a.com/": { size: "full" },
      "https://b.com/": { hidden: true },
    };
    const next = applyPrefPatch(prefs, "https://a.com/", { hidden: true });
    expect(next["https://b.com/"]).toBe(prefs["https://b.com/"]);
  });
});

describe("nextSize", () => {
  test("full → compact", () => {
    expect(nextSize("full")).toBe("compact");
  });

  test("compact → full", () => {
    expect(nextSize("compact")).toBe("full");
  });
});

describe("extractOEmbedCandidates", () => {
  test("returns external URLs not handled by regex providers", () => {
    const text =
      "Check the Canva design: https://www.canva.com/design/DAF123/View";
    const urls = extractOEmbedCandidates(text);

    expect(urls).toEqual(["https://www.canva.com/design/DAF123/View"]);
  });

  test("skips URLs already covered by a regex provider (YouTube, Loom, Figma, GDocs)", () => {
    const text = [
      "https://www.youtube.com/watch?v=abc12345678",
      "https://www.loom.com/share/abc123",
      "https://www.figma.com/file/XYZ/Design",
      "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      "https://open.spotify.com/track/abc",
    ].join(" ");

    const urls = extractOEmbedCandidates(text);

    expect(urls).toEqual(["https://open.spotify.com/track/abc"]);
  });

  test("strips trailing punctuation from detected URLs", () => {
    const text = "See (https://codepen.io/anon/pen/abc), it's cool.";
    const urls = extractOEmbedCandidates(text);

    expect(urls).toContain("https://codepen.io/anon/pen/abc");
  });

  test("deduplicates identical URLs", () => {
    const url = "https://codepen.io/anon/pen/abc";
    const urls = extractOEmbedCandidates(`${url} and again ${url}`);

    expect(urls).toHaveLength(1);
  });

  test("caps the number of candidates at MAX_EMBEDS (3)", () => {
    const urls = extractOEmbedCandidates(
      [
        "https://codepen.io/a/pen/1",
        "https://codepen.io/a/pen/2",
        "https://codepen.io/a/pen/3",
        "https://codepen.io/a/pen/4",
      ].join(" "),
    );

    expect(urls).toHaveLength(3);
  });

  test("returns an empty array for plain text without URLs", () => {
    expect(extractOEmbedCandidates("just some words")).toEqual([]);
  });
});
