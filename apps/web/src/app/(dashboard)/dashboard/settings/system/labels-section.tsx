"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { ColorPatchGrid, PRESET_COLORS } from "@/components/color-patch-grid";

interface Label {
  id: string;
  name: string;
  color: string;
}

export function LabelsSection() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0].hex);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const { success, error: showError } = useToast();
  const confirm = useConfirm();

  const loadLabels = () => {
    apiFetch<Label[]>("/labels")
      .then((data) => {
        setLabels(data);
        setLoading(false);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to load labels");
        setLoading(false);
      });
  };

  useEffect(() => {
    loadLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await apiFetch("/labels", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      setNewName("");
      setNewColor(PRESET_COLORS[0].hex);
      success("Label created");
      loadLabels();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create label");
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (label: Label) => {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await apiFetch(`/labels/${editingId}`, {
        method: "PUT",
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      setEditingId(null);
      success("Label updated");
      loadLabels();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update label");
    }
  };

  const handleDelete = async (label: Label) => {
    const ok = await confirm({
      title: "Delete Label",
      message: `Delete "${label.name}"? It will be removed from all assigned items.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/labels/${label.id}`, { method: "DELETE" });
      success("Label deleted");
      loadLabels();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete label");
    }
  };

  if (loading) return <div className="text-sm text-[var(--muted-foreground)]">Loading labels...</div>;

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="w-7 h-7 rounded-full shrink-0 border border-[var(--border)]"
            style={{ backgroundColor: newColor }}
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New label name"
            maxLength={50}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
        <ColorPatchGrid value={newColor} onChange={setNewColor} />
      </div>

      {/* Labels list */}
      {labels.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No labels yet.</p>
      ) : (
        <div className="space-y-1.5">
          {labels.map((label) => (
            <div
              key={label.id}
              className="border border-[var(--border)] rounded-lg"
            >
              {editingId === label.id ? (
                <div className="p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-full shrink-0"
                      style={{ backgroundColor: editColor }}
                    />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={50}
                      className="flex-1 px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-1 text-green-600 hover:text-green-700"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <ColorPatchGrid value={editColor} onChange={setEditColor} />
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2">
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 text-sm">{label.name}</span>
                  <button
                    onClick={() => handleEdit(label)}
                    className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(label)}
                    className="p-1 text-[var(--muted-foreground)] hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
