"use client";

import { useState } from "react";
import { Upload, X, File as FileIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { track } from "@/lib/track";
import { useToast } from "@/components/toast";

type Mode = "file" | "link";

const ACCEPT = ".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.webp";
const INPUT = "w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm";

export function DeliverableModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}): React.ReactElement {
  const { success, error: showError } = useToast();
  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [reminders, setReminders] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const pickFile = (f: File | null): void => {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (): Promise<void> => {
    if (!title.trim() || (mode === "file" ? !file : !url.trim())) return;
    setSaving(true);
    try {
      if (mode === "file" && file) {
        const form = new FormData();
        form.append("file", file);
        form.append("projectId", projectId);
        form.append("type", "deliverable");
        form.append("title", title.trim());
        if (note.trim()) form.append("note", note.trim());
        form.append("reminderEnabled", String(reminders));
        form.append("sendNow", "true");
        await apiFetch("/documents", { method: "POST", body: form });
      } else {
        await apiFetch("/documents/link", {
          method: "POST",
          body: JSON.stringify({ projectId, title: title.trim(), url: url.trim(), note: note.trim() || undefined, reminderEnabled: reminders, sendNow: true }),
        });
      }
      track("deliverable_sent", { mode });
      success("Sent to the client for approval");
      onCreated();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to send for approval");
    } finally {
      setSaving(false);
    }
  };

  const segment = (m: Mode): string =>
    `flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${mode === m ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-[480px] mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold">Request approval</h3>
        <div className="flex gap-1 p-0.5 border border-[var(--border)] rounded-lg">
          <button type="button" onClick={() => setMode("file")} className={segment("file")}>File</button>
          <button type="button" onClick={() => setMode("link")} className={segment("link")}>Link</button>
        </div>
        <div>
          <label htmlFor="deliverable-title" className="text-sm text-[var(--muted-foreground)]">Title</label>
          <input id="deliverable-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Homepage design" className={INPUT} />
        </div>
        {mode === "file" ? (
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">File</label>
            {file ? (
              <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg text-sm">
                <FileIcon size={14} className="text-[var(--muted-foreground)] shrink-0" />
                <span className="truncate flex-1">{file.name}</span>
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">{formatBytes(file.size)}</span>
                <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="text-[var(--muted-foreground)] hover:text-red-500"><X size={14} /></button>
              </div>
            ) : (
              <label className="mt-1 flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] cursor-pointer hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors">
                <Upload size={14} /> Choose file
                <input type="file" accept={ACCEPT} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="hidden" />
              </label>
            )}
          </div>
        ) : (
          <div>
            <label htmlFor="deliverable-url" className="text-sm text-[var(--muted-foreground)]">URL</label>
            <input id="deliverable-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://figma.com/…" className={INPUT} />
          </div>
        )}
        <div>
          <label htmlFor="deliverable-note" className="text-sm text-[var(--muted-foreground)]">Note to client</label>
          <textarea id="deliverable-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Optional" className={INPUT} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={reminders} onChange={(e) => setReminders(e.target.checked)} className="accent-[var(--primary)]" />
          <span className="text-sm">Remind the client after 3 days</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !title.trim() || (mode === "file" ? !file : !url.trim())}
            className="px-4 py-2 text-sm bg-[var(--primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Sending…" : "Send for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}
