"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { FolderKanban } from "lucide-react";
import { track } from "@/lib/track";

interface StepFirstProjectProps {
  onNext: () => void;
  onBack: () => void;
}

export function StepFirstProject({ onNext, onBack }: StepFirstProjectProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      // Same event name as the dashboard so activation counts are complete;
      // source separates onboarding creation from day-to-day creation.
      track("project_created", { source: "setup" });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Create Your First Project</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Projects are how you organize work for your clients. You can always
          create more later.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      <div className="p-6 border border-[var(--border)] rounded-lg space-y-4">
        <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
          <FolderKanban size={18} />
          <span className="text-sm font-medium">New Project</span>
        </div>

        <div className="space-y-2">
          <label htmlFor="setup-project-name" className="text-sm font-medium">
            Project Name
          </label>
          <input
            id="setup-project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website Redesign"
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="setup-project-desc" className="text-sm font-medium">
            Description{" "}
            <span className="text-[var(--muted-foreground)] font-normal">
              (optional)
            </span>
          </label>
          <textarea
            id="setup-project-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the project scope..."
            rows={3}
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
          />
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={() => {
              track("setup_step_skipped", { step: "project" });
              onNext();
            }}
            className="px-6 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-6 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
