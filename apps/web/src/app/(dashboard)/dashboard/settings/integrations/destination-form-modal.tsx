"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { INTEGRATION_EVENT_GROUPS, INTEGRATION_TYPES } from "@atrium/shared";
import type { IntegrationEvent, IntegrationType } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { TYPE_LABELS, URL_HELP } from "./types";
import type { CreatedIntegration, IntegrationSummary, ProjectOption } from "./types";

/** Copy of `set` with `id` added or removed. */
function toggled<T>(set: Set<T>, id: T): Set<T> {
  const next: Set<T> = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface DestinationFormModalProps {
  /** Present when editing. */
  existing?: IntegrationSummary;
  projects: ProjectOption[];
  onClose: () => void;
  onSaved: (saved: CreatedIntegration) => void;
}

export function DestinationFormModal({
  existing, projects, onClose, onSaved,
}: DestinationFormModalProps): React.ReactElement {
  const [type, setType] = useState<IntegrationType>(existing?.type ?? "slack");
  const [name, setName] = useState<string>(existing?.name ?? "");
  const [url, setUrl] = useState<string>("");
  const [events, setEvents] = useState<Set<IntegrationEvent>>(new Set(existing?.events ?? []));
  const [allProjects, setAllProjects] = useState<boolean>((existing?.projectIds.length ?? 0) === 0);
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set(existing?.projectIds ?? []));
  const [busy, setBusy] = useState<boolean>(false);
  const { error: showError } = useToast();
  const help = URL_HELP[type];

  const toggleGroup = (ids: IntegrationEvent[], on: boolean): void => {
    const next: Set<IntegrationEvent> = new Set(events);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setEvents(next);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (!allProjects && projectIds.size === 0) {
      showError("Pick at least one project, or choose all projects");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      events: [...events],
      projectIds: allProjects ? [] : [...projectIds],
    };
    if (url.trim()) body.url = url.trim();
    try {
      const saved = existing
        ? await apiFetch<CreatedIntegration>(`/integrations/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
        : await apiFetch<CreatedIntegration>("/integrations", {
          method: "POST",
          body: JSON.stringify({ ...body, type }),
        });
      onSaved(saved);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to save integration");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4"
        data-testid="integration-form"
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">{existing ? `Edit ${existing.name}` : "Add integration"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {!existing && (
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Integration type">
            {INTEGRATION_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  type === t
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                    : "border-[var(--border)]"
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="integration-name" className="block text-xs text-[var(--muted-foreground)] mb-1">Name</label>
          <input
            id="integration-name"
            type="text"
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "webhook" ? "Zapier: invoices" : "#client-updates"}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label htmlFor="integration-url" className="block text-xs text-[var(--muted-foreground)] mb-1">
            {TYPE_LABELS[type]} URL
          </label>
          <input
            id="integration-url"
            type="url"
            value={url}
            required={!existing}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={existing ? `${existing.urlPreview} (leave blank to keep)` : help.placeholder}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {help.help}{" "}
            {help.link && (
              <a href={help.link} target="_blank" rel="noreferrer" className="text-[var(--primary)] hover:underline">
                How do I get this?
              </a>
            )}
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-xs text-[var(--muted-foreground)] mb-1">Events</legend>
          {INTEGRATION_EVENT_GROUPS.map((group) => {
            const ids: IntegrationEvent[] = group.events.map((ev) => ev.id);
            const allOn: boolean = ids.every((id) => events.has(id));
            return (
              <div key={group.label} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{group.label}</span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(ids, !allOn)}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  {group.events.map((ev) => (
                    <label key={ev.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={events.has(ev.id)} onChange={() => setEvents(toggled(events, ev.id))} />
                      {ev.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs text-[var(--muted-foreground)] mb-1">Projects</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={allProjects} onChange={() => setAllProjects(true)} />
            All projects
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={!allProjects} onChange={() => setAllProjects(false)} />
            Only selected projects
          </label>
          {!allProjects && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] p-2 space-y-1">
              {projects.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No projects yet.</p>
              ) : (
                projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={projectIds.has(p.id)} onChange={() => setProjectIds(toggled(projectIds, p.id))} />
                    {p.name}
                  </label>
                ))
              )}
            </div>
          )}
          <p className="text-xs text-[var(--muted-foreground)]">
            Workspace events like a Stripe disconnect are always sent.
          </p>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-[var(--border)]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim() || (!existing && !url.trim())}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {existing ? "Save" : "Add integration"}
          </button>
        </div>
      </form>
    </div>
  );
}
