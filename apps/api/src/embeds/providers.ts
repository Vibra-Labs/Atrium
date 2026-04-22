/**
 * Curated oEmbed provider registry.
 *
 * Maps a request URL's hostname to the provider's oEmbed endpoint. We only
 * resolve URLs whose hostname appears here — link-rel autodiscovery is not
 * performed as it would expand the SSRF surface.
 */

export interface OEmbedProvider {
  name: string;
  /** Hostnames (exact match, lowercased, no leading `www.`) served by this provider. */
  hostnames: string[];
  /** oEmbed endpoint returning JSON. Appended with `?url=<encoded>&format=json`. */
  endpoint: string;
  /**
   * Optional allowed iframe `src` hostnames returned by the provider's HTML.
   * When set, the sanitizer will reject iframes whose src host isn't in this list.
   */
  iframeHostnames?: string[];
}

export const OEMBED_PROVIDERS: OEmbedProvider[] = [
  {
    name: "Canva",
    hostnames: ["canva.com"],
    endpoint: "https://www.canva.com/_oembed",
    iframeHostnames: ["canva.com", "www.canva.com"],
  },
  {
    name: "Spotify",
    hostnames: ["spotify.com", "open.spotify.com"],
    endpoint: "https://open.spotify.com/oembed",
    iframeHostnames: ["open.spotify.com"],
  },
  {
    name: "SoundCloud",
    hostnames: ["soundcloud.com"],
    endpoint: "https://soundcloud.com/oembed",
    iframeHostnames: ["w.soundcloud.com", "soundcloud.com"],
  },
  {
    name: "CodePen",
    hostnames: ["codepen.io"],
    endpoint: "https://codepen.io/api/oembed",
    iframeHostnames: ["codepen.io"],
  },
  {
    name: "Vimeo",
    hostnames: ["vimeo.com"],
    endpoint: "https://vimeo.com/api/oembed.json",
    iframeHostnames: ["player.vimeo.com"],
  },
  // Twitter/X is intentionally NOT in this registry. Its oEmbed response is a
  // <blockquote> plus <script src="https://platform.twitter.com/widgets.js">,
  // which our iframe-only sanitizer correctly rejects. Supporting it requires
  // a separate code path (allowing a pinned Twitter widgets script) or using
  // an unofficial platform.twitter.com embed URL. Tracked as a follow-up.
];

/**
 * Find the provider whose hostname list matches the given URL, if any.
 * Matches on exact host (after stripping leading `www.`) so that
 * `open.spotify.com` matches but `evil-spotify.com.attacker.com` does not.
 */
export function findProvider(rawUrl: string): OEmbedProvider | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  for (const provider of OEMBED_PROVIDERS) {
    if (provider.hostnames.includes(host)) return provider;
  }
  return null;
}
