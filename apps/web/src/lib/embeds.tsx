const MAX_EMBEDS = 3;

const YT_RE = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([\w-]+)/g;
const LOOM_RE = /https?:\/\/(?:www\.)?loom\.com\/share\/([\w-]+)/g;
const FIGMA_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([\w-]+[^\s]*)/g;
const GDOCS_RE = /https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/g;

export type EmbedProvider = "youtube" | "loom" | "figma" | "google-docs";

export interface EmbedInfo {
  originalUrl: string;
  embedUrl: string;
  provider: EmbedProvider;
}

const PROVIDER_LABELS: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  loom: "Loom",
  figma: "Figma",
  "google-docs": "Google Docs",
};

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

export function EmbedPreview({ embed }: { embed: EmbedInfo }) {
  const label = PROVIDER_LABELS[embed.provider];

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-[var(--border)]">
      <div className="px-3 py-1.5 bg-[var(--muted)] border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      </div>
      <div className="relative aspect-video">
        <iframe
          src={embed.embedUrl}
          className="absolute inset-0 w-full h-full"
          allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          title={`${label} embed`}
        />
      </div>
      <div className="px-3 py-1.5 bg-[var(--muted)] border-t border-[var(--border)]">
        <a
          href={embed.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--primary)] hover:underline"
        >
          Open in {label}
        </a>
      </div>
    </div>
  );
}
