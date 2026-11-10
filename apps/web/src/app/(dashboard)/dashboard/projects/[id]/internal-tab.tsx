"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";

export interface InternalItems {
  updates: { id: string; content: string; createdAt: string; file: { id: string; filename: string } | null }[];
  files: { id: string; filename: string; type: string; createdAt: string }[];
  tasks: { id: string; title: string; status: string; type: string; createdAt: string }[];
  documents: { id: string; title: string; type: string; status: string; createdAt: string }[];
}

export type InternalKind = "update" | "file" | "task" | "document";

export function internalCount(items: InternalItems | null): number {
  if (!items) return 0;
  return items.updates.length + items.files.length + items.tasks.length + items.documents.length;
}

interface Row {
  kind: InternalKind;
  id: string;
  title: string;
  detail: string;
  createdAt: string;
}

const day = (d: string): string => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Everything made while the project was a potential contract. Hidden from the client; each item can
 * be shared on its own.
 */
export function InternalTab({
  projectId,
  items,
  onChanged,
}: {
  projectId: string;
  items: InternalItems;
  onChanged: () => void;
}) {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [sharing, setSharing] = useState<string | null>(null);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Updates",
      rows: items.updates.map((u) => ({
        kind: "update",
        id: u.id,
        title: u.content.length > 120 ? `${u.content.slice(0, 120)}…` : u.content,
        detail: u.file ? `With ${u.file.filename}` : "",
        createdAt: u.createdAt,
      })),
    },
    {
      title: "Files",
      rows: items.files.map((f) => ({ kind: "file", id: f.id, title: f.filename, detail: "", createdAt: f.createdAt })),
    },
    {
      title: "Tasks",
      rows: items.tasks.map((t) => ({
        kind: "task",
        id: t.id,
        title: t.title,
        detail: t.status.replace(/_/g, " "),
        createdAt: t.createdAt,
      })),
    },
    {
      title: "Documents",
      rows: items.documents.map((d) => ({
        kind: "document",
        id: d.id,
        title: d.title,
        detail: d.status === "draft" ? "Draft: send it before the client can see it" : d.status,
        createdAt: d.createdAt,
      })),
    },
  ].filter((g) => g.rows.length > 0) as { title: string; rows: Row[] }[];

  async function share(row: Row): Promise<void> {
    const ok: boolean = await confirm({
      title: "Share with the client?",
      message: `"${row.title}" was written for your team while this was a potential contract. Once shared, anyone with portal access to this project can see it.`,
      confirmLabel: "Share",
    });
    if (!ok) return;
    setSharing(row.id);
    try {
      await apiFetch(`/projects/${projectId}/internal/${row.kind}/${row.id}/share`, { method: "POST" });
      success("Shared with the client");
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharing(null);
    }
  }

  return (
    <div className="space-y-5" data-testid="pre-win-items">
      <div>
        <h2 className="text-sm font-medium">From before the win</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Made while this was a potential contract. Clients can&apos;t see these until you share them.
        </p>
      </div>
      {groups.map((g) => (
        <section key={g.title} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{g.title}</h3>
          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
            {g.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{row.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {day(row.createdAt)}
                    {row.detail && ` · ${row.detail}`}
                  </p>
                </div>
                <button
                  onClick={() => share(row)}
                  disabled={sharing === row.id}
                  aria-label={`Share ${row.title} with client`}
                  className="shrink-0 px-3 py-1.5 border border-[var(--border)] rounded-lg text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
                >
                  {sharing === row.id ? "Sharing..." : "Share with client"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
