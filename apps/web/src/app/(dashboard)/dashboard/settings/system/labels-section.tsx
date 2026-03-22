"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

interface Label {
  id: string;
  name: string;
  color: string;
}

export function LabelsSection() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
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
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await apiFetch("/labels", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      setNewName("");
      setNewColor("#6b7280");
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
      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer p-0"
        />
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New label name"
          maxLength={50}
          className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Plus size={14} />
          Add
        </button>
      </form>

      {/* Labels list */}
      {labels.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No labels yet.</p>
      ) : (
        <div className="space-y-1.5">
          {labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center gap-2 p-2 border border-[var(--border)] rounded-lg"
            >
              {editingId === label.id ? (
                <>
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="w-6 h-6 rounded border border-[var(--border)] cursor-pointer p-0"
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
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
