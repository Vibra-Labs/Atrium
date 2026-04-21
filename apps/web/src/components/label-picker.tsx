"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Pencil, Settings } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Link from "next/link";
import { ColorPatchGrid, PRESET_COLORS } from "@/components/color-patch-grid";

interface Label {
  id: string;
  name: string;
  color: string;
}

export function LabelPicker({
  labels,
  assigned,
  onToggle,
  onLabelsChange,
  disabled,
  align = "left",
}: {
  labels: Label[];
  assigned: string[];
  onToggle: (labelId: string) => void;
  onLabelsChange?: (labels: Label[]) => void;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0].hex);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const assignedSet = new Set(assigned);

  const handleCreate = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    setCreateError("");
    try {
      const created = await apiFetch<Label>("/labels", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (onLabelsChange) {
        const updated = await apiFetch<Label[]>("/labels");
        onLabelsChange(updated);
      }
      onToggle(created.id);
      setNewName("");
      setNewColor(PRESET_COLORS[0].hex);
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create label");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
        aria-label="Edit labels"
      >
        <Pencil size={12} />
      </button>

      {open && (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-64 bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-lg z-50 flex flex-col overflow-hidden`}>
          {/* Existing labels */}
          <div className="max-h-48 overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
            {labels.length === 0 && !creating && (
              <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                No labels yet.
              </p>
            )}
            {labels.map((label) => (
              <div
                key={label.id}
                role="option"
                aria-selected={assignedSet.has(label.id)}
                onClick={() => onToggle(label.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 text-left truncate">{label.name}</span>
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                  assignedSet.has(label.id)
                    ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                    : "border-[var(--border)]"
                }`}>
                  {assignedSet.has(label.id) && "✓"}
                </span>
              </div>
            ))}
          </div>

          {/* Inline create */}
          {creating ? (
            <div className="border-t border-[var(--border)] px-3 py-2 space-y-2">
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Label name"
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
                className="w-full px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
              />
              <ColorPatchGrid value={newColor} onChange={setNewColor} />
              {createError && (
                <p className="text-xs text-red-500">{createError}</p>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || saving}
                  className="flex-1 px-2 py-1 bg-[var(--primary)] text-white rounded text-xs font-medium disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => { setCreating(false); setCreateError(""); }}
                  className="px-2 py-1 border border-[var(--border)] rounded text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-[var(--border)]">
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <Plus size={12} />
                Create new label
              </button>
              <Link
                href="/dashboard/settings/system"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <Settings size={12} />
                Manage labels
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
