"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Facebook, Instagram, Link as LinkIcon, Linkedin, Phone, Twitter, Youtube } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { socialSite, telHref } from "@/lib/contact-fields";
import type { SocialSite } from "@/lib/contact-fields";
import { apiFetch } from "@/lib/api";
import { TYPEAHEAD_LIMIT, useListboxKeys, useTypeahead } from "@/lib/use-typeahead";
import { useToast } from "@/components/toast";
import { LabelPicker } from "@/components/label-picker";
import { LabelBadge } from "@/components/label-badge";
import { inputClass } from "../shared";
import { FollowUpCard } from "./follow-up-card";
import type { ContactDetail } from "./types";
import { useCachedApi } from "@/lib/cached";

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
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  // Linked projects are hidden from the results, so ask for enough to still show 10 others.
  const { items: options } = useTypeahead<ProjectOption>(
    "/projects",
    search.trim(),
    searching,
    TYPEAHEAD_LIMIT + contact.projects.length,
  );

  const linkedIds = new Set(contact.projects.map((p) => p.id));
  const available = options.filter((p) => !linkedIds.has(p.id)).slice(0, TYPEAHEAD_LIMIT);
  const pickerId: string = useId();
  const keys = useListboxKeys(available.length, searching, setSearching, (i) => void pick(available[i].id));

  async function pick(projectId: string): Promise<void> {
    if (await link(projectId)) {
      setSearch("");
      setSearching(false);
    }
  }

  async function link(projectId: string): Promise<boolean> {
    try {
      await apiFetch(`/contacts/${contact.id}/projects/${projectId}`, { method: "POST" });
      onChanged();
      return true;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to link project");
      return false;
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
      // Keep the form open if linking fails; the project already exists.
      if (!(await link(project.id))) return;
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
      <div className="relative mb-2">
        <input
          role="combobox"
          aria-label="Link a project"
          aria-expanded={searching}
          aria-controls={`${pickerId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={searching && keys.active >= 0 ? `${pickerId}-${keys.active}` : undefined}
          placeholder="Link existing project…"
          value={search}
          autoComplete="off"
          onChange={(e) => {
            setSearch(e.target.value);
            setSearching(true);
          }}
          onFocus={() => setSearching(true)}
          onBlur={() => setSearching(false)}
          onKeyDown={keys.onKeyDown}
          className={inputClass}
        />
        {searching && (
          <ul
            id={`${pickerId}-list`}
            role="listbox"
            aria-label="Projects"
            className="absolute z-10 mt-1 w-full max-h-60 overflow-auto bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg text-sm"
          >
            {available.length === 0 && (
              <li role="presentation" className="px-3 py-2 text-[var(--muted-foreground)]">
                No matching projects
              </li>
            )}
            {available.map((p, i) => (
              <li
                key={p.id}
                id={`${pickerId}-${i}`}
                role="option"
                aria-selected={i === keys.active}
                // preventDefault keeps focus in the input, so the list stays open until a pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void pick(p.id);
                }}
                className={`px-3 py-2 cursor-pointer hover:bg-[var(--muted)] ${i === keys.active ? "bg-[var(--muted)]" : ""}`}
              >
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </div>
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
  const orgLabels: Label[] = useCachedApi<Label[]>("/labels") ?? [];

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

// lucide-react 0.474 has no TikTok icon: TikTok shows the generic icon with its domain.
const SITE_ICONS: Partial<Record<SocialSite, LucideIcon>> = {
  linkedin: Linkedin,
  instagram: Instagram,
  x: Twitter,
  facebook: Facebook,
  youtube: Youtube,
};

function PhonesList({ phones }: { phones: ContactDetail["phones"] }) {
  if (phones.length === 0) return null;
  return (
    <ul className="space-y-1" aria-label="Phone numbers">
      {phones.map((p, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <Phone size={13} className="shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <a href={telHref(p.number)} className="hover:underline">
            {p.number}
          </a>
          <span className="text-xs text-[var(--muted-foreground)]">{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SocialLinks({ links }: { links: string[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Social links">
      {links.map((url) => {
        const { site, host } = socialSite(url);
        const Icon = SITE_ICONS[site];
        return (
          <li key={url}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={host}
              title={url}
              className="inline-flex items-center gap-1 p-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              {Icon ? (
                <Icon size={16} aria-hidden />
              ) : (
                <>
                  <LinkIcon size={14} aria-hidden />
                  <span className="text-xs">{host}</span>
                </>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 items-baseline">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function DetailsSection({ contact }: { contact: ContactDetail }) {
  const hasAny: boolean = Boolean(
    contact.email ||
      contact.phones.length > 0 ||
      contact.website ||
      contact.address ||
      contact.leadSource ||
      contact.referredBy ||
      contact.description ||
      contact.socialLinks.length > 0,
  );
  return (
    <section>
      <h2 className={headingClass}>Details</h2>
      {!hasAny ? (
        <p className="text-sm text-[var(--muted-foreground)]">No details yet.</p>
      ) : (
        <dl data-testid="contact-details" className="space-y-2 text-sm">
          {contact.email && (
            <DetailRow label="Email">
              <a href={`mailto:${contact.email}`} className="hover:underline">
                {contact.email}
              </a>
            </DetailRow>
          )}
          {contact.phones.length > 0 && (
            <DetailRow label={contact.phones.length > 1 ? "Phones" : "Phone"}>
              <PhonesList phones={contact.phones} />
            </DetailRow>
          )}
          {contact.website && <DetailRow label="Website">{contact.website}</DetailRow>}
          {contact.address && (
            <DetailRow label="Address">
              <span className="whitespace-pre-line">{contact.address}</span>
            </DetailRow>
          )}
          {contact.leadSource && <DetailRow label="Source">{contact.leadSource.name}</DetailRow>}
          {contact.referredBy && (
            <DetailRow label="Referred by">
              <Link href={`/dashboard/contacts/${contact.referredBy.id}`} className="hover:underline">
                {contact.referredBy.name}
              </Link>
            </DetailRow>
          )}
          {contact.socialLinks.length > 0 && (
            <DetailRow label="Social">
              <SocialLinks links={contact.socialLinks} />
            </DetailRow>
          )}
          {contact.description && (
            <DetailRow label="About">
              <span data-testid="contact-about" className="whitespace-pre-line">
                {contact.description}
              </span>
            </DetailRow>
          )}
        </dl>
      )}
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
