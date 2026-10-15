"use client";

import { useState } from "react";
import { Upload, X, File as FileIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { useToast } from "@/components/toast";

interface VersionDoc {
  id: string;
  title: string;
  currentVersion?: number;
  file: { type?: "UPLOAD" | "LINK" };
}

const INPUT = "w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm";

export function DeliverableVersionModal({
  doc,
  onClose,
  onUploaded,
}: {
  doc: VersionDoc;
  onClose: () => void;
  onUploaded: () => void;
}): React.ReactElement {
  const { success, error: showError } = useToast();
  const next: number = (doc.currentVersion ?? 1) + 1;
  const isLink: boolean = doc.file.type === "LINK";
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const ready: boolean = isLink ? !!url.trim() : !!file;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setSaving(true);
    try {
      if (isLink) {
        await apiFetch(`/documents/${doc.id}/link-version`, {
          method: "POST",
          body: JSON.stringify({ url: url.trim(), note: note.trim() || undefined }),
        });
      } else if (file) {
        const form = new FormData();
        form.append("file", file);
        if (note.trim()) form.append("note", note.trim());
        await apiFetch(`/documents/${doc.id}/upload-version`, { method: "POST", body: form });
      }
      success(`Version ${next} sent to the client`);
      onUploaded();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to send new version");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-[480px] mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold">Upload v{next}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">{doc.title}</p>
        {isLink ? (
          <div>
            <label htmlFor="version-url" className="text-sm text-[var(--muted-foreground)]">New URL</label>
            <input id="version-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://figma.com/…" className={INPUT} />
          </div>
        ) : (
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
                <input type="file" accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
              </label>
            )}
          </div>
        )}
        <div>
          <label htmlFor="version-note" className="text-sm text-[var(--muted-foreground)]">What changed?</label>
          <textarea id="version-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Optional" className={INPUT} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !ready} className="px-4 py-2 text-sm bg-[var(--primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? "Sending…" : `Send v${next}`}
          </button>
        </div>
      </div>
    </div>
  );
}
