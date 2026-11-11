"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { track } from "@/lib/track";
import { usePipelines } from "@/lib/pursuit";
import type { Pipeline } from "@/lib/pursuit";
import { KindPicker, Modal } from "./_pursuit/pursuit-ui";
import type { NewKind } from "./_pursuit/pursuit-ui";

export interface CreatedProject {
  id: string;
  name: string;
}

/** The "New project" pop-up, shared by the dashboard and the projects page. */
export function NewProjectModal({
  onClose,
  onCreated,
  oneProjectLeft = false,
  initialKind = "project",
}: {
  onClose: () => void;
  onCreated: (project: CreatedProject) => void;
  oneProjectLeft?: boolean;
  initialKind?: NewKind;
}) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [kind, setKind] = useState<NewKind>(initialKind);
  const [creating, setCreating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const pipelines: Pipeline[] | null = usePipelines();
  // Empty means the first pipeline, so the form works before pipelines load.
  const [pipelineId, setPipelineId] = useState<string>("");

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const created = await apiFetch<CreatedProject>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          ...(kind === "pursuit" ? { potential: true, ...(pipelineId ? { pipelineId } : {}) } : {}),
        }),
      });
      track("project_created", { source: "dashboard" });
      onCreated(created);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title={kind === "pursuit" ? "New potential contract" : "New project"} onClose={onClose}>
      <form onSubmit={handleCreate} className="space-y-3">
        {oneProjectLeft && (
          <div className="flex items-center justify-between rounded-lg bg-[var(--muted)] border border-[var(--border)] px-3 py-2">
            <p className="text-xs text-[var(--muted-foreground)]">
              <span className="font-medium text-[var(--foreground)]">Last free project.</span> Upgrade to Pro for unlimited.
            </p>
            <Link
              href="/dashboard/settings/billing?reason=projects"
              className="text-xs font-medium text-[var(--primary)] hover:opacity-80 whitespace-nowrap ml-3"
            >
              Upgrade →
            </Link>
          </div>
        )}
        <KindPicker value={kind} onChange={setKind} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "pursuit" ? "County RFP: records system" : "Project name"}
          required
          autoFocus
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
        />
        {kind === "pursuit" && pipelines && pipelines.length > 1 && (
          <select
            aria-label="Pipeline"
            value={pipelineId || pipelines[0].id}
            onChange={(e) => setPipelineId(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
          >
            {pipelines.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name} pipeline
              </option>
            ))}
          </select>
        )}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
          rows={2}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create"}
        </button>
      </form>
    </Modal>
  );
}
