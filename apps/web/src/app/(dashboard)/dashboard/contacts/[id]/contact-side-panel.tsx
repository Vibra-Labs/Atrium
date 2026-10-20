"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { LabelPicker } from "@/components/label-picker";
import { LabelBadge } from "@/components/label-badge";
import { inputClass } from "../shared";
import { FollowUpCard } from "./follow-up-card";
import type { ContactDetail } from "./types";

interface Label {
  id: string;
  name: string;
  color: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  contact: ContactDetail;
  onChanged: () => void;
}

const headingClass =
  "text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2";

function ProjectsSection({ contact, onChanged }: Props) {
  const { error: showError } = useToast();
  const [options, setOptions] = useState<ProjectOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    apiFetch<{ data: ProjectOption[] }>("/projects?limit=100")
      .then((res) => setOptions(res.data))
      .catch(console.error);
  }, [contact.projects.length]);

  const linkedIds = new Set(contact.projects.map((p) => p.id));
  const available = options.filter((p) => !linkedIds.has(p.id));

  async function link(projectId: string): Promise<void> {
    try {
      await apiFetch(`/contacts/${contact.id}/projects/${projectId}`, { method: "POST" });
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to link project");
    }
  }

  async function unlink(projectId: string): Promise<void> {
    try {
      await apiFetch(`/contacts/${contact.id}/projects/${projectId}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to unlink project");
    }
  }

  async function createAndLink(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const project = await apiFetch<{ id: string }>("/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await link(project.id);
      setNewName("");
      setCreating(false);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to create project");
    }
  }

  return (
    <section>
      <h2 className={headingClass}>Projects</h2>
      <ul className="space-y-1 text-sm mb-2">
        {contact.projects.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <Link href={`/dashboard/projects/${p.id}`} className="hover:underline">
                {p.name}
              </Link>{" "}
              <span className="text-xs text-[var(--muted-foreground)]">({p.status})</span>
            </span>
            <button
              onClick={() => unlink(p.id)}
              aria-label={`Unlink ${p.name}`}
              className="text-xs text-[var(--muted-foreground)] hover:text-red-600"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <select
          aria-label="Link a project"
          value=""
          onChange={(e) => e.target.value && link(e.target.value)}
          className={`${inputClass} mb-2`}
        >
          <option value="">Link existing project…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {creating ? (
        <form onSubmit={createAndLink} className="flex gap-2">
          <input
            aria-label="New project name"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            className={inputClass}
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="px-3 py-1 bg-[var(--primary)] text-white rounded-lg text-sm disabled:opacity-40"
          >
            Create
          </button>
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          + New project
        </button>
      )}
    </section>
  );
}

function TagsSection({ contact, onChanged }: Props) {
  const { error: showError } = useToast();
  const [orgLabels, setOrgLabels] = useState<Label[]>([]);

  useEffect(() => {
    apiFetch<Label[]>("/labels").then(setOrgLabels).catch(console.error);
  }, []);

  const assigned = contact.labels.map((l) => l.id);

  async function toggle(labelId: string): Promise<void> {
    try {
      await apiFetch(`/labels/${labelId}/assign`, {
        method: assigned.includes(labelId) ? "DELETE" : "POST",
        body: JSON.stringify({ entityType: "contact", entityId: contact.id }),
      });
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to update tags");
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Tags
        </h2>
        <LabelPicker
          labels={orgLabels}
          assigned={assigned}
          onToggle={toggle}
          onLabelsChange={setOrgLabels}
          align="right"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {contact.labels.map((l) => (
          <LabelBadge key={l.id} name={l.name} color={l.color} />
        ))}
      </div>
    </section>
  );
}

function DetailsSection({ contact }: { contact: ContactDetail }) {
  const rows: [string, string | null | undefined][] = [
    ["Email", contact.email],
    ["Phone", contact.phone],
    ["Website", contact.website],
    ["Address", contact.address],
    ["Source", contact.leadSource?.name],
  ];
  return (
    <section>
      <h2 className={headingClass}>Details</h2>
      <dl className="space-y-1 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="sr-only">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        {contact.referredBy && (
          <div>
            <dt className="sr-only">Referred by</dt>
            <dd>
              Referred by{" "}
              <Link href={`/dashboard/contacts/${contact.referredBy.id}`} className="hover:underline">
                {contact.referredBy.name}
              </Link>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function ContactSidePanel({ contact, onChanged }: Props) {
  return (
    <aside className="space-y-6 md:border-l md:border-[var(--border)] md:pl-4">
      <FollowUpCard
        contactId={contact.id}
        followUpAt={contact.followUpAt}
        everyDays={contact.followUpEveryDays}
        onChanged={onChanged}
      />
      <ProjectsSection contact={contact} onChanged={onChanged} />
      <DetailsSection contact={contact} />
      <TagsSection contact={contact} onChanged={onChanged} />
    </aside>
  );
}
