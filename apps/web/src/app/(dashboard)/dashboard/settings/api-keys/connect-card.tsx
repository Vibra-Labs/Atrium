"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/components/toast";

type ClientId = "claude-code" | "json" | "anthropic-api";

interface Snippet {
  id: ClientId;
  label: string;
  code: (url: string) => string;
}

const SNIPPETS: Snippet[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    code: (url) =>
      `claude mcp add --transport http atrium ${url} \\\n  --header "Authorization: Bearer YOUR_API_KEY"`,
  },
  {
    id: "json",
    label: "Cursor / JSON config",
    code: (url) =>
      JSON.stringify(
        { mcpServers: { atrium: { url, headers: { Authorization: "Bearer YOUR_API_KEY" } } } },
        null,
        2,
      ),
  },
  {
    id: "anthropic-api",
    label: "Anthropic API",
    code: (url) =>
      JSON.stringify(
        {
          mcp_servers: [{ type: "url", url, name: "atrium", authorization_token: "YOUR_API_KEY" }],
          tools: [{ type: "mcp_toolset", mcp_server_name: "atrium" }],
        },
        null,
        2,
      ),
  },
];

/** Server and first client render must agree, so `window` is read only in an effect. */
function configuredMcpUrl(): string {
  return `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/mcp`;
}

export function ConnectCard(): React.ReactElement {
  const [active, setActive] = useState<ClientId>("claude-code");
  const [url, setUrl] = useState<string>(configuredMcpUrl());
  const { success, error: showError } = useToast();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_API_URL) return;
    setUrl(`${window.location.origin}/api/mcp`);
  }, []);

  const snippet: Snippet = SNIPPETS.find((s) => s.id === active) ?? SNIPPETS[0];

  const copy = async (text: string): Promise<void> => {
    const copied: boolean = await copyToClipboard(text);
    if (copied) success("Copied to clipboard");
    else showError("Could not copy");
  };

  return (
    <section className="space-y-4 pt-8">
      <div>
        <h2 className="text-base font-semibold">Connect an AI assistant</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Atrium speaks the Model Context Protocol (MCP). Point any MCP client at this URL and send an API
          key as a bearer token. Works with Claude, OpenAI, local models, and agent frameworks.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code data-testid="mcp-url" className="flex-1 break-all rounded bg-[var(--muted)] px-2 py-1 text-xs">
          {url}
        </code>
        <button type="button" onClick={() => void copy(url)} aria-label="Copy MCP URL" className="p-2">
          <Copy size={16} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)]">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            className={`px-3 py-1.5 text-sm ${
              s.id === active ? "border-b-2 border-[var(--primary)] font-medium" : "text-[var(--muted-foreground)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-xs">{snippet.code(url)}</pre>
        <button
          type="button"
          onClick={() => void copy(snippet.code(url))}
          aria-label="Copy snippet"
          className="absolute right-2 top-2 p-1"
        >
          <Copy size={14} />
        </button>
      </div>
    </section>
  );
}
