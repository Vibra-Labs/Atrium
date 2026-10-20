"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { NEW_SOURCE, inputClass } from "./shared";

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
  const [companies, setCompanies] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ data: Option[] }>("/companies?limit=100")
      .then((res) => setCompanies(res.data))
      .catch(console.error);
  }, []);

  const matches = companies
    .filter((c) => c.name.toLowerCase().includes(text.trim().toLowerCase()))
    .slice(0, 6);

  return (
    <div className="relative">
      <label htmlFor="contact-company" className="block text-sm text-[var(--muted-foreground)] mb-1">
        Company
      </label>
      <input
        id="contact-company"
        value={text}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={inputClass}
      />
      {open && text.trim() && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg text-sm overflow-hidden"
        >
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={() => {
                  onChange(c.name, c.id);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-[var(--muted)]"
              >
                {c.name}
              </button>
            </li>
          ))}
          {!companies.some((c) => c.name.toLowerCase() === text.trim().toLowerCase()) && (
            <li className="px-3 py-2 text-[var(--muted-foreground)]">Create “{text.trim()}”</li>
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
