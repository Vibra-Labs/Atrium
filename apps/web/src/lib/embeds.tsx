"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, X, ExternalLink } from "lucide-react";

const MAX_EMBEDS = 3;

const YT_RE = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([\w-]+)/g;
const LOOM_RE = /https?:\/\/(?:www\.)?loom\.com\/share\/([\w-]+)/g;
const FIGMA_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([\w-]+[^\s]*)/g;
const GDOCS_RE = /https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/g;

const URL_RE = /https?:\/\/[^\s<>"']+/g;

export type EmbedProvider = "youtube" | "loom" | "figma" | "google-docs";

export interface EmbedInfo {
  originalUrl: string;
  embedUrl: string;
  provider: EmbedProvider;
}

export type PreviewSize = "compact" | "full";

export interface PreviewPref {
  size?: PreviewSize;
  hidden?: boolean;
}

export type PreviewPrefs = Record<string, PreviewPref>;

const PROVIDER_LABELS: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  loom: "Loom",
  figma: "Figma",
  "google-docs": "Google Docs",
};

// ---------------------------------------------------------------------------
// Regex fast-path detection (zero network).
// ---------------------------------------------------------------------------

export function getEmbeds(text: string): EmbedInfo[] {
  const found: EmbedInfo[] = [];
  const seen = new Set<string>();

  const push = (originalUrl: string, embedUrl: string, provider: EmbedProvider) => {
    if (!seen.has(embedUrl)) {
      seen.add(embedUrl);
      found.push({ originalUrl, embedUrl, provider });
    }
  };

  YT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YT_RE.exec(text)) !== null) {
    push(m[0], `https://www.youtube.com/embed/${m[1]}`, "youtube");
  }

  LOOM_RE.lastIndex = 0;
  while ((m = LOOM_RE.exec(text)) !== null) {
    push(m[0], `https://www.loom.com/embed/${m[1]}`, "loom");
  }

  FIGMA_RE.lastIndex = 0;
  while ((m = FIGMA_RE.exec(text)) !== null) {
    push(m[0], `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(m[0])}`, "figma");
  }

  GDOCS_RE.lastIndex = 0;
  while ((m = GDOCS_RE.exec(text)) !== null) {
    push(m[0], `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, "google-docs");
  }

  return found.slice(0, MAX_EMBEDS);
}

const REGEX_PROVIDER_HOSTS = [
  "youtube.com",
  "youtu.be",
  "loom.com",
  "figma.com",
  "docs.google.com",
];

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isRegexProviderHost(host: string): boolean {
  return REGEX_PROVIDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function extractOEmbedCandidates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    if (seen.has(url)) continue;
    const host = hostnameOf(url);
    if (!host || isRegexProviderHost(host)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_EMBEDS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared controls + card chrome
// ---------------------------------------------------------------------------

interface PreviewControlsProps {
  size: PreviewSize;
  onToggleSize: () => void;
  onHide: () => void;
}

function PreviewControls({ size, onToggleSize, onHide }: PreviewControlsProps) {
  const toggleLabel = size === "full" ? "Collapse preview" : "Expand preview";
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleSize}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="p-1 rounded hover:bg-[var(--background)]/60 text-[var(--muted-foreground)]"
      >
        {size === "full" ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      <button
        type="button"
        onClick={onHide}
        aria-label="Hide preview"
        title="Hide preview"
        className="p-1 rounded hover:bg-[var(--background)]/60 text-[var(--muted-foreground)]"
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface CardShellProps {
  label: string;
  size: PreviewSize;
  onToggleSize: () => void;
  onHide: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function CardShell({ label, size, onToggleSize, onHide, children, footer }: CardShellProps) {
  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-[var(--border)] max-w-xl">
      <div className="px-3 py-1.5 bg-[var(--muted)] border-b border-[var(--border)] flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted-foreground)] truncate">
          {label}
        </span>
        <PreviewControls size={size} onToggleSize={onToggleSize} onHide={onHide} />
      </div>
      {children}
      {footer}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regex-based embed (iframe)
// ---------------------------------------------------------------------------

export function EmbedPreview({
  embed,
  size,
  onToggleSize,
  onHide,
}: {
  embed: EmbedInfo;
  size: PreviewSize;
  onToggleSize: () => void;
  onHide: () => void;
}) {
  const label = PROVIDER_LABELS[embed.provider];
  const footer = (
    <div className="px-3 py-1.5 bg-[var(--muted)] border-t border-[var(--border)]">
      <a
        href={embed.originalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1"
      >
        Open in {label}
        <ExternalLink size={10} />
      </a>
    </div>
  );

  return (
    <CardShell label={label} size={size} onToggleSize={onToggleSize} onHide={onHide} footer={footer}>
      {size === "full" && (
        <div className="relative aspect-video">
          <iframe
            src={embed.embedUrl}
            className="absolute inset-0 w-full h-full"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            title={`${label} embed`}
          />
        </div>
      )}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// oEmbed provider (iframe from server-side resolver)
// ---------------------------------------------------------------------------

interface OEmbedResult {
  html: string;
  width?: number;
  height?: number;
  providerName: string;
  title?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

async function resolveOEmbed(url: string): Promise<OEmbedResult | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/embeds/resolve?url=${encodeURIComponent(url)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as OEmbedResult;
  } catch {
    return null;
  }
}

export function OEmbedPreview({
  url,
  size,
  onToggleSize,
  onHide,
  onFail,
}: {
  url: string;
  size: PreviewSize;
  onToggleSize: () => void;
  onHide: () => void;
  /** Called when oEmbed resolution fails so the caller can fall back to unfurl. */
  onFail?: () => void;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; result: OEmbedResult } | { kind: "failed" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    resolveOEmbed(url).then((result) => {
      if (cancelled) return;
      if (result) {
        setState({ kind: "ready", result });
      } else {
        setState({ kind: "failed" });
        onFail?.();
      }
    });
    return () => {
      cancelled = true;
    };
    // onFail is intentionally not a dep — callers memoize it only when they must.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (state.kind === "loading") {
    return (
      <CardShell label="Loading embed…" size={size} onToggleSize={onToggleSize} onHide={onHide}>
        <div className="relative aspect-video bg-[var(--muted)] animate-pulse" />
      </CardShell>
    );
  }

  if (state.kind === "failed") return null;

  const { result } = state;
  const footer = (
    <div className="px-3 py-1.5 bg-[var(--muted)] border-t border-[var(--border)]">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1"
      >
        Open in {result.providerName}
        <ExternalLink size={10} />
      </a>
    </div>
  );

  return (
    <CardShell
      label={result.providerName}
      size={size}
      onToggleSize={onToggleSize}
      onHide={onHide}
      footer={footer}
    >
      {size === "full" && (
        <div
          className="oembed-content [&_iframe]:max-w-full [&_iframe]:w-full [&_iframe]:block"
          // HTML is sanitized server-side to an iframe-only allowlist.
          dangerouslySetInnerHTML={{ __html: result.html }}
        />
      )}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Generic Open Graph unfurl card
// ---------------------------------------------------------------------------

interface UnfurlCard {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

async function fetchUnfurl(url: string): Promise<UnfurlCard | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/embeds/unfurl?url=${encodeURIComponent(url)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as UnfurlCard;
  } catch {
    return null;
  }
}

export function UnfurlPreview({
  url,
  size,
  onToggleSize,
  onHide,
}: {
  url: string;
  size: PreviewSize;
  onToggleSize: () => void;
  onHide: () => void;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; card: UnfurlCard } | { kind: "failed" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchUnfurl(url).then((card) => {
      if (cancelled) return;
      setState(card ? { kind: "ready", card } : { kind: "failed" });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const host = hostnameOf(url) ?? url;

  if (state.kind === "loading") {
    return (
      <CardShell label={host} size={size} onToggleSize={onToggleSize} onHide={onHide}>
        <div className="p-3 animate-pulse">
          <div className="h-3 w-1/2 bg-[var(--muted)] rounded mb-2" />
          <div className="h-2 w-full bg-[var(--muted)] rounded" />
        </div>
      </CardShell>
    );
  }

  if (state.kind === "failed") return null;

  const { card } = state;
  const label = card.siteName || host;

  return (
    <CardShell
      label={label}
      size={size}
      onToggleSize={onToggleSize}
      onHide={onHide}
    >
      <a
        href={card.url || url}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:bg-[var(--muted)]/40 transition-colors"
      >
        {size === "compact" ? (
          <div className="flex items-center gap-2 px-3 py-2">
            {card.favicon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.favicon}
                alt=""
                className="w-4 h-4 shrink-0"
                loading="lazy"
              />
            )}
            <span className="text-sm font-medium truncate">
              {card.title || url}
            </span>
          </div>
        ) : (
          <div className="flex flex-col">
            {card.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.image}
                alt=""
                className="w-full max-h-48 object-cover"
                loading="lazy"
              />
            )}
            <div className="p-3">
              <div className="flex items-center gap-2 mb-1">
                {card.favicon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.favicon} alt="" className="w-4 h-4 shrink-0" loading="lazy" />
                )}
                <span className="text-xs text-[var(--muted-foreground)] truncate">
                  {host}
                </span>
              </div>
              {card.title && (
                <p className="text-sm font-medium line-clamp-2 mb-1">{card.title}</p>
              )}
              {card.description && (
                <p className="text-xs text-[var(--muted-foreground)] line-clamp-2">
                  {card.description}
                </p>
              )}
            </div>
          </div>
        )}
      </a>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface EmbedsProps {
  text: string;
  prefs?: PreviewPrefs;
  onPrefsChange?: (next: PreviewPrefs) => void;
}

/**
 * Renders the full set of previews for an update body:
 * - regex providers (zero network)
 * - oEmbed providers (server-resolved iframe)
 * - generic OG unfurl card (server-resolved)
 *
 * Each preview supports a compact/full size toggle and a hide × button.
 * Preference changes are bubbled via `onPrefsChange`; the caller is expected
 * to persist them (see updates-section.tsx / portal page).
 */
export function Embeds({ text, prefs = {}, onPrefsChange }: EmbedsProps) {
  const regexEmbeds = useMemo(() => getEmbeds(text), [text]);
  const nonRegexUrls = useMemo(() => {
    if (regexEmbeds.length >= MAX_EMBEDS) return [];
    const remaining = MAX_EMBEDS - regexEmbeds.length;
    return extractOEmbedCandidates(text).slice(0, remaining);
  }, [text, regexEmbeds.length]);

  // Track which of the non-regex URLs failed oEmbed and should fall back to unfurl.
  const [oembedFailed, setOembedFailed] = useState<Record<string, boolean>>({});

  const mutatePref = (url: string, patch: PreviewPref) => {
    const next: PreviewPrefs = { ...prefs, [url]: { ...(prefs[url] || {}), ...patch } };
    onPrefsChange?.(next);
  };

  const toggleSize = (url: string, current: PreviewSize) => {
    mutatePref(url, { size: current === "full" ? "compact" : "full" });
  };

  const hide = (url: string) => {
    mutatePref(url, { hidden: true });
  };

  const markOembedFailed = (url: string) => {
    setOembedFailed((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  if (regexEmbeds.length === 0 && nonRegexUrls.length === 0) return null;

  return (
    <>
      {regexEmbeds.map((embed) => {
        const key = embed.originalUrl;
        const pref = prefs[key] || {};
        if (pref.hidden) return null;
        const size: PreviewSize = pref.size ?? "full";
        return (
          <EmbedPreview
            key={embed.embedUrl}
            embed={embed}
            size={size}
            onToggleSize={() => toggleSize(key, size)}
            onHide={() => hide(key)}
          />
        );
      })}
      {nonRegexUrls.map((url) => {
        const pref = prefs[url] || {};
        if (pref.hidden) return null;
        const size: PreviewSize = pref.size ?? "full";

        // If oEmbed previously failed for this URL, go straight to unfurl.
        if (oembedFailed[url]) {
          return (
            <UnfurlPreview
              key={url}
              url={url}
              size={size}
              onToggleSize={() => toggleSize(url, size)}
              onHide={() => hide(url)}
            />
          );
        }

        return (
          <OEmbedPreview
            key={url}
            url={url}
            size={size}
            onToggleSize={() => toggleSize(url, size)}
            onHide={() => hide(url)}
            onFail={() => markOembedFailed(url)}
          />
        );
      })}
    </>
  );
}
