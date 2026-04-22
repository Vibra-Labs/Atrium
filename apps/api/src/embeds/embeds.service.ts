import { Injectable, Logger } from "@nestjs/common";
import sanitizeHtml from "sanitize-html";
import { findProvider, OEmbedProvider } from "./providers";

export interface OEmbedResult {
  html: string;
  width?: number;
  height?: number;
  providerName: string;
  thumbnailUrl?: string;
  title?: string;
}

interface CacheEntry {
  value: OEmbedResult | null;
  expiresAt: number;
}

const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5000;

@Injectable()
export class EmbedsService {
  private readonly logger = new Logger(EmbedsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  async resolve(url: string): Promise<OEmbedResult | null> {
    const provider = findProvider(url);
    if (!provider) return null;

    const cacheKey = `${provider.name}:${url}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let result: OEmbedResult | null = null;
    try {
      result = await this.fetchAndSanitize(provider, url);
    } catch (err) {
      this.logger.warn(`oEmbed fetch failed for ${url}: ${(err as Error).message}`);
      result = null;
    }

    this.storeInCache(cacheKey, result);
    return result;
  }

  private async fetchAndSanitize(
    provider: OEmbedProvider,
    url: string,
  ): Promise<OEmbedResult | null> {
    const endpoint = `${provider.endpoint}?url=${encodeURIComponent(url)}&format=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.debug(
        `oEmbed provider ${provider.name} returned ${response.status} for ${url}`,
      );
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawHtml = typeof data.html === "string" ? data.html : null;
    if (!rawHtml) return null;

    const sanitized = this.sanitizeIframeHtml(rawHtml, provider);
    if (!sanitized) return null;

    return {
      html: sanitized,
      width: typeof data.width === "number" ? data.width : undefined,
      height: typeof data.height === "number" ? data.height : undefined,
      providerName: provider.name,
      thumbnailUrl:
        typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined,
      title: typeof data.title === "string" ? data.title : undefined,
    };
  }

  /**
   * Strip everything except a single `<iframe>` element with a narrowly
   * allowed attribute set. Returns `null` if the result would be empty.
   *
   * The `src` attribute is additionally constrained to the provider's
   * expected iframe hostnames (when declared) to limit what a compromised
   * or misbehaving provider can get us to frame.
   */
  private sanitizeIframeHtml(
    rawHtml: string,
    provider: OEmbedProvider,
  ): string | null {
    const allowedIframeHosts = provider.iframeHostnames?.map((h) =>
      h.toLowerCase(),
    );

    const clean = sanitizeHtml(rawHtml, {
      allowedTags: ["iframe"],
      allowedAttributes: {
        iframe: [
          "src",
          "width",
          "height",
          "frameborder",
          "allow",
          "allowfullscreen",
          "allowtransparency",
          "scrolling",
          "title",
          "loading",
          "referrerpolicy",
        ],
      },
      allowedSchemesByTag: { iframe: ["https"] },
      allowedIframeHostnames: allowedIframeHosts,
      // Reject any attribute not explicitly listed.
      disallowedTagsMode: "discard",
      // Drop comments and scripts.
      allowedSchemes: ["https"],
    });

    const trimmed = clean.trim();
    // Require an iframe with a valid src — sanitize-html keeps the <iframe>
    // tag even when it strips a disallowed src, so we must reject that case
    // explicitly.
    if (!trimmed || !/<iframe[^>]+src=/i.test(trimmed)) return null;
    return trimmed;
  }

  private storeInCache(key: string, value: OEmbedResult | null) {
    if (this.cache.size >= CACHE_MAX) {
      // Evict the oldest entry (Maps preserve insertion order).
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
