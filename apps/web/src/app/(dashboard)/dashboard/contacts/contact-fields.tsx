"use client";

import { useId, useState } from "react";
import { useListboxKeys, useTypeahead } from "@/lib/use-typeahead";
import { ChevronDown, X } from "lucide-react";
import { NEW_SOURCE, PHONE_LABELS, RATING_LABELS, inputClass, labelClass } from "./shared";
import type { ContactPhone } from "./shared";

const MAX_ROWS = 10;
const addButtonClass = "text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
const removeButtonClass =
  "shrink-0 p-2 rounded-lg text-[var(--muted-foreground)] hover:text-red-600 hover:bg-[var(--muted)]";

/** Rows with a number, labels defaulting to "Mobile". */
export function cleanPhones(rows: ContactPhone[]): ContactPhone[] {
  return rows
    .map((p) => ({ label: p.label.trim() || PHONE_LABELS[0], number: p.number.trim() }))
    .filter((p) => p.number);
}

/** Non-blank links; a bare "linkedin.com/in/x" gets https:// in front. */
export function cleanLinks(rows: string[]): string[] {
  return rows
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[a-z][a-z\d+.-]*:/i.test(l) ? l : `https://${l}`));
}

interface PhonesFieldProps {
  idPrefix: string;
  phones: ContactPhone[];
  onChange: (phones: ContactPhone[]) => void;
}

export function PhonesField({ idPrefix, phones, onChange }: PhonesFieldProps) {
  const listId = `${idPrefix}-phone-labels`;
  const set = (i: number, patch: Partial<ContactPhone>): void =>
    onChange(phones.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>Phone numbers</legend>
      <datalist id={listId}>
        {PHONE_LABELS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      {phones.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input
            aria-label={`Phone label ${i + 1}`}
            list={listId}
            value={p.label}
            maxLength={30}
            onChange={(e) => set(i, { label: e.target.value })}
            className={inputClass.replace("w-full", "w-28 shrink-0")}
          />
          <input
            aria-label={`Phone number ${i + 1}`}
            type="tel"
            value={p.number}
            maxLength={50}
            onChange={(e) => set(i, { number: e.target.value })}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={`Remove phone ${i + 1}`}
            onClick={() => onChange(phones.filter((_, j) => j !== i))}
            className={removeButtonClass}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
      {phones.length < MAX_ROWS && (
        <button
          type="button"
          onClick={() => onChange([...phones, { label: PHONE_LABELS[0], number: "" }])}
          className={addButtonClass}
        >
          + Add phone
        </button>
      )}
    </fieldset>
  );
}

interface SocialLinksFieldProps {
  links: string[];
  onChange: (links: string[]) => void;
}

export function SocialLinksField({ links, onChange }: SocialLinksFieldProps) {
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>Social links</legend>
      {links.map((link, i) => (
        <div key={i} className="flex gap-2">
          <input
            aria-label={`Social link ${i + 1}`}
            inputMode="url"
            placeholder="https://linkedin.com/in/…"
            value={link}
            maxLength={500}
            onChange={(e) => onChange(links.map((l, j) => (j === i ? e.target.value : l)))}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={`Remove link ${i + 1}`}
            onClick={() => onChange(links.filter((_, j) => j !== i))}
            className={removeButtonClass}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
      {links.length < MAX_ROWS && (
        <button type="button" onClick={() => onChange([...links, ""])} className={addButtonClass}>
          + Add link
        </button>
      )}
    </fieldset>
  );
}

interface RatingFieldProps {
  id: string;
  value: string;
  onChange: (rating: string) => void;
}

export function RatingField({ id, value, onChange }: RatingFieldProps) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Rating
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">—</option>
        {Object.entries(RATING_LABELS).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface Option {
  id: string;
  name: string;
}

interface CompanyFieldProps {
  text: string;
  onChange: (text: string, companyId: string | null) => void;
}

/** Company typeahead: pick an existing company or type a new name to create one. */
export function CompanyField({ text, onChange }: CompanyFieldProps) {
  const [open, setOpen] = useState(false);
  const listId: string = useId();
  const term: string = text.trim();
  const { items: matches, loading } = useTypeahead<Option>("/companies", term, open && term !== "");
  const showList: boolean = open && term !== "";

  function pick(c: Option): void {
    onChange(c.name, c.id);
    setOpen(false);
  }
  const keys = useListboxKeys(matches.length, showList, setOpen, (i) => pick(matches[i]));

  return (
    <div className="relative">
      <label htmlFor="contact-company" className="block text-sm text-[var(--muted-foreground)] mb-1">
        Company
      </label>
      <input
        id="contact-company"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && keys.active >= 0 ? `${listId}-${keys.active}` : undefined}
        value={text}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={keys.onKeyDown}
        className={inputClass}
      />
      {showList && (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Companies"
          className="absolute z-10 mt-1 w-full bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg text-sm overflow-hidden"
        >
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === keys.active}
              // preventDefault keeps focus in the input until the pick lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              className={`px-3 py-2 cursor-pointer hover:bg-[var(--muted)] ${i === keys.active ? "bg-[var(--muted)]" : ""}`}
            >
              {c.name}
            </li>
          ))}
          {!loading && !matches.some((c) => c.name.toLowerCase() === term.toLowerCase()) && (
            <li role="presentation" className="px-3 py-2 text-[var(--muted-foreground)]">
              Create “{term}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

interface SourceFieldProps {
  sources: Option[];
  choice: string;
  newSource: string;
  onChoice: (choice: string) => void;
  onNewSource: (name: string) => void;
}

/** Source dropdown with an "Add new source" option; the name input shows when it is chosen. */
export function SourceField({ sources, choice, newSource, onChoice, onNewSource }: SourceFieldProps) {
  return (
    <>
      <div>
        <label htmlFor="contact-source" className="block text-sm text-[var(--muted-foreground)] mb-1">
          Source
        </label>
        <select
          id="contact-source"
          value={choice}
          onChange={(e) => onChoice(e.target.value)}
          className={inputClass}
        >
          <option value="">None</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={NEW_SOURCE}>
            {newSource.trim() ? `Add “${newSource.trim()}”` : "Add new source…"}
          </option>
        </select>
      </div>
      {choice === NEW_SOURCE && (
        <input
          aria-label="New source name"
          placeholder="New source name"
          value={newSource}
          maxLength={100}
          onChange={(e) => onNewSource(e.target.value)}
          className={`${inputClass} col-span-2 order-last`}
        />
      )}
    </>
  );
}

interface MoreFieldsProps {
  defaultOpen?: boolean;
  /** How many of the hidden fields have a value, so nothing filled in is out of sight unnoticed. */
  filled?: number;
  children: React.ReactNode;
}

/** Keeps the less-used fields of a form out of the way until asked for. */
export function MoreFields({ defaultOpen = false, filled = 0, children }: MoreFieldsProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`${addButtonClass} inline-flex items-center gap-1`}
      >
        <ChevronDown aria-hidden="true" className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Less info" : `More info${filled > 0 ? ` · ${filled} filled` : ""}`}
      </button>
      {open && (
        <div id={id} className="space-y-4">
          {children}
        </div>
      )}
    </>
  );
}
