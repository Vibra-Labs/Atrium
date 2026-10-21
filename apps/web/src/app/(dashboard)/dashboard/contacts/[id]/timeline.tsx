"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { inputClass } from "../shared";

interface TimelineItem {
  kind: "note" | "event";
  id: string;
  createdAt: string;
  content?: string;
  detail?: string;
  type?: string;
  author?: { id: string; name: string };
}

interface TimelinePage {
  data: TimelineItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const LIMIT = 20;
/** The note box grows with its text up to this many lines, then scrolls. */
const MAX_NOTE_ROWS = 6;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Timeline({ contactId, refreshKey }: { contactId: string; refreshKey: number }) {
  const { error: showError } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: fit the textarea to its content, capped at MAX_NOTE_ROWS lines.
  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    // Tailwind uses border-box, so height = content + padding (scrollHeight) + borders.
    const borders: number = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const padding: number = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const lineHeight: number = parseFloat(style.lineHeight) || 20;
    const max: number = lineHeight * MAX_NOTE_ROWS + padding + borders;
    const wanted: number = el.scrollHeight + borders;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [note]);

  // Always reloads from page 1; "Show more" appends further pages.
  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiFetch<TimelinePage>(`/contacts/${contactId}/timeline?page=1&limit=${LIMIT}`);
      setItems(res.data);
      setPage(1);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
      showError("Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [contactId, showError]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function showMore(): Promise<void> {
    const next = page + 1;
    try {
      const res = await apiFetch<TimelinePage>(
        `/contacts/${contactId}/timeline?page=${next}&limit=${LIMIT}`,
      );
      setItems((prev) => [...prev, ...res.data]);
      setPage(next);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
      showError("Failed to load timeline");
    }
  }

  async function addNote(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    if (saving) return;
    const content = note.trim();
    if (!content) return;
    setSaving(true);
    try {
      await apiFetch(`/contacts/${contactId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setNote("");
      await load();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(noteId: string): Promise<void> {
    const ok = await confirm({
      title: "Delete note",
      message: "Delete this note? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/contacts/${contactId}/notes/${noteId}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== noteId));
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to delete note");
    }
  }

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
        Timeline
      </h2>
      <form onSubmit={addNote} className="mb-3 space-y-2">
        <textarea
          ref={noteRef}
          rows={1}
          aria-label="Add a note"
          placeholder="Add a note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addNote();
            }
          }}
          className={`${inputClass} resize-none block`}
        />
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-[var(--muted-foreground)] hidden sm:inline">⌘/Ctrl + Enter to save</span>
          <button
            type="submit"
            disabled={saving || !note.trim()}
            className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm whitespace-nowrap shrink-0 hover:opacity-90 disabled:bg-[var(--muted)] disabled:text-[var(--muted-foreground)] disabled:hover:opacity-100 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Add note"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">Nothing yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} data-testid={`timeline-${item.kind}`} className="flex gap-2">
              <span className="font-semibold shrink-0">{formatDate(item.createdAt)}</span>
              <span className="flex-1 min-w-0 break-words">
                {item.kind === "note" ? (
                  <>
                    Note: {item.content}
                    {item.author && (
                      <span className="text-xs text-[var(--muted-foreground)]"> · {item.author.name}</span>
                    )}
                  </>
                ) : (
                  <>
                    {item.detail}{" "}
                    <span className="text-xs text-[var(--muted-foreground)]">(auto)</span>
                  </>
                )}
              </span>
              {item.kind === "note" && (
                <button
                  onClick={() => deleteNote(item.id)}
                  aria-label="Delete note"
                  className="text-xs text-[var(--muted-foreground)] hover:text-red-600"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {page < totalPages && (
        <button
          onClick={showMore}
          className="mt-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Show more
        </button>
      )}
    </section>
  );
}
