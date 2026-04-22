import { Injectable, Logger } from "@nestjs/common";
import { safeFetch, SsrfError } from "./safe-fetch";

export interface UnfurlCard {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

interface CacheEntry {
  value: UnfurlCard | null;
  expiresAt: number;
}

const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class UnfurlService {
  private readonly logger = new Logger(UnfurlService.name);
  private readonly cache = new Map<string, CacheEntry>();

  async unfurl(url: string): Promise<UnfurlCard | null> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value: UnfurlCard | null = null;
    try {
      value = await this.fetchAndParse(url);
    } catch (err) {
      if (err instanceof SsrfError) {
        this.logger.warn(`unfurl blocked by SSRF guard: ${err.message}`);
      } else {
        this.logger.warn(
          `unfurl failed for ${url}: ${(err as Error).message}`,
        );
      }
    }

    this.storeInCache(url, value);
    return value;
  }

  private async fetchAndParse(url: string): Promise<UnfurlCard | null> {
    const response = await safeFetch(url);
    if (response.status < 200 || response.status >= 300) return null;

    // Only parse HTML-ish responses.
    const contentType = (response.contentType || "").toLowerCase();
    if (contentType && !contentType.includes("html")) return null;

    const parsed = parseMeta(response.body, response.finalUrl);
    if (!parsed.title && !parsed.description && !parsed.image) return null;

    return { url: response.finalUrl, ...parsed };
  }

  private storeInCache(key: string, value: UnfurlCard | null) {
    if (this.cache.size >= CACHE_MAX) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

// ---------------------------------------------------------------------------
// HTML parsing (regex-based, no JS execution, no external fetches)
// ---------------------------------------------------------------------------

interface ParsedMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

/**
 * Extract Open Graph / Twitter Card / plain `<title>` and favicon from raw
 * HTML. We truncate to the first 256KB of the document — meta tags always
 * live in `<head>`, and refusing to scan arbitrarily large bodies bounds CPU.
 */
export function parseMeta(html: string, baseUrl: string): ParsedMeta {
  const head = html.slice(0, 256 * 1024);

  const og = (prop: string) => matchMetaProperty(head, prop);
  const name = (n: string) => matchMetaName(head, n);

  const title =
    og("og:title") ||
    name("twitter:title") ||
    matchTitleTag(head) ||
    undefined;

  const description =
    og("og:description") || name("twitter:description") || name("description");

  const image = og("og:image") || name("twitter:image");

  const siteName = og("og:site_name");

  const faviconRel = matchFavicon(head);
  const favicon = faviconRel ? absolutize(faviconRel, baseUrl) : undefined;

  return {
    title: title?.trim() || undefined,
    description: description?.trim() || undefined,
    image: image ? absolutize(image, baseUrl) : undefined,
    siteName: siteName?.trim() || undefined,
    favicon,
  };
}

function absolutize(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function matchMetaProperty(head: string, prop: string): string | undefined {
  // <meta property="og:title" content="..."> — also tolerate swapped order.
  const pattern = new RegExp(
    `<meta[^>]+property=["']${escapeRegex(prop)}["'][^>]*>`,
    "i",
  );
  const tag = head.match(pattern)?.[0];
  if (!tag) return undefined;
  return extractContent(tag);
}

function matchMetaName(head: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${escapeRegex(name)}["'][^>]*>`,
    "i",
  );
  const tag = head.match(pattern)?.[0];
  if (!tag) return undefined;
  return extractContent(tag);
}

function extractContent(tag: string): string | undefined {
  const match = tag.match(/\bcontent=["']([^"']*)["']/i);
  if (!match) return undefined;
  return decodeHtmlEntities(match[1]);
}

function matchTitleTag(head: string): string | undefined {
  const match = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return undefined;
  return decodeHtmlEntities(match[1]).trim();
}

function matchFavicon(head: string): string | undefined {
  // Prefer icon / shortcut icon links.
  const linkTags = head.match(/<link[^>]+>/gi) || [];
  for (const tag of linkTags) {
    const rel = tag.match(/\brel=["']([^"']*)["']/i)?.[1]?.toLowerCase();
    if (!rel) continue;
    if (rel.includes("icon")) {
      const href = tag.match(/\bhref=["']([^"']*)["']/i)?.[1];
      if (href) return href;
    }
  }
  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
