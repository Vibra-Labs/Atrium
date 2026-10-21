"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { mentionToken, splitMentions } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { inputClass, labelClass } from "./shared";

/** A contact picked from a search: by @ in a note, or as a referrer. */
export interface PickedContact {
  id: string;
  name: string;
}

const MAX_QUERY = 40;

/** The "@query" being typed just before the caret, or null when the caret isn't in one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  // "me@ann.com" is an email, not a mention: the @ must start a word.
  if (at > 0 && !/[\s(]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n@]/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** Swaps the typed "@query" (from `start` to `caret`) for "@Name ". */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/** The note as stored: every "@Name" of a picked contact becomes a mention link. */
export function toNoteContent(text: string, mentions: PickedContact[]): string {
  // Longest names first, so "@Ann Lee" isn't half-replaced as "@Ann".
  const byLength = [...mentions].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const m of byLength) {
    const plain = `@${m.name}`;
    // Only whole names: not followed by more letters ("@Ann" inside "@Annie").
    out = out.replace(new RegExp(`${escapeRegExp(plain)}(?![\\p{L}\\p{N}])`, "gu"), mentionToken(m.name, m.id));
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A note with its mentions as links to those contacts. */
export function NoteContent({ content }: { content: string }) {
  return (
    <>
      {splitMentions(content).map((part, i) =>
        "mention" in part ? (
          <Link
            key={i}
            href={`/dashboard/contacts/${part.mention.contactId}`}
            className="text-[var(--primary)] hover:underline"
          >
            @{part.mention.name}
          </Link>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Contacts matching `query` (debounced); the first few by name when it is empty. */
function useContactSearch(query: string | null, excludeId?: string): PickedContact[] {
  const [results, setResults] = useState<PickedContact[]>([]);
  useEffect(() => {
    if (query === null) {
      setResults([]);
      return;
    }
    // Set by the cleanup, so a response for an older query can't overwrite the newer one.
    let stale = false;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "6" });
      if (query.trim()) params.set("search", query.trim());
      apiFetch<{ data: PickedContact[] }>(`/contacts?${params}`)
        .then((res) => {
          if (!stale) setResults(res.data.filter((c) => c.id !== excludeId).map((c) => ({ id: c.id, name: c.name })));
        })
        .catch((err: unknown) => {
          console.error(err);
          if (!stale) setResults([]);
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, excludeId]);
  return results;
}

interface PickerListProps {
  id: string;
  results: PickedContact[];
  active: number;
  onPick: (c: PickedContact) => void;
}

function PickerList({ id, results, active, onPick }: PickerListProps) {
  if (results.length === 0) return null;
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Contacts"
      className="absolute z-20 mt-1 w-full max-w-sm bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg text-sm overflow-hidden"
    >
      {results.map((c, i) => (
        <li
          key={c.id}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          // mousedown, so the textarea keeps focus and the caret position.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          className={`px-3 py-2 cursor-pointer ${i === active ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]"}`}
        >
          {c.name}
        </li>
      ))}
    </ul>
  );
}

/** Arrow keys / Enter / Tab / Escape for an open picker; true when the key was used. */
function pickerKey(
  e: React.KeyboardEvent,
  results: PickedContact[],
  active: number,
  setActive: (i: number) => void,
  pick: (c: PickedContact) => void,
  close: () => void,
): boolean {
  if (results.length === 0) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive((active + step + results.length) % results.length);
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return false;
    e.preventDefault();
    pick(results[active] ?? results[0]);
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
    return true;
  }
  return false;
}

interface MentionTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  mentions: PickedContact[];
  onMentionsChange: (mentions: PickedContact[]) => void;
  /** The contact the note is on, left out of the suggestions. */
  excludeId?: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

/** A note box where typing @ suggests contacts; picked names are kept for toNoteContent. */
export function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  excludeId,
  textareaRef,
  onKeyDown,
  ...rest
}: MentionTextareaProps) {
  const listId = useId();
  const [typing, setTyping] = useState<{ start: number; query: string; caret: number } | null>(null);
  const [active, setActive] = useState<number>(0);
  const results = useContactSearch(typing ? typing.query : null, excludeId);

  function track(el: HTMLTextAreaElement): void {
    const caret = el.selectionStart ?? el.value.length;
    const found = mentionQuery(el.value, caret);
    setTyping(found ? { ...found, caret } : null);
    setActive(0);
  }

  function pick(c: PickedContact, el: HTMLTextAreaElement | null): void {
    if (!typing) return;
    const next = insertMention(value, typing.start, typing.caret, c.name);
    onChange(next.text);
    if (!mentions.some((m) => m.id === c.id)) onMentionsChange([...mentions, c]);
    setTyping(null);
    requestAnimationFrame(() => el?.setSelectionRange(next.caret, next.caret));
  }

  const open = typing !== null && results.length > 0;
  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={textareaRef}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
        }}
        onClick={(e) => track(e.currentTarget)}
        onBlur={() => setTyping(null)}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if (open && pickerKey(e, results, active, setActive, (c) => pick(c, el), () => setTyping(null))) return;
          onKeyDown?.(e);
        }}
      />
      {typing && <PickerList id={listId} results={results} active={active} onPick={(c) => pick(c, null)} />}
    </div>
  );
}

interface ReferrerFieldProps {
  id: string;
  value: PickedContact | null;
  onChange: (value: PickedContact | null) => void;
  /** The contact being edited: it can't refer itself. */
  excludeId?: string;
}

/** "Referred by": search contacts by name (an @ in front works too) and pick one. */
export function ReferrerField({ id, value, onChange, excludeId }: ReferrerFieldProps) {
  const listId = useId();
  const [search, setSearch] = useState<string>("");
  const [active, setActive] = useState<number>(0);
  const [focused, setFocused] = useState<boolean>(false);
  const query = search.replace(/^\s*@/, "");
  const found = useContactSearch(query.trim() ? query : null, excludeId);
  // Suggestions only while typing here, so they never cover the next field.
  const results = focused ? found : [];

  function pick(c: PickedContact): void {
    onChange(c);
    setSearch("");
  }

  return (
    <div className="relative">
      <label htmlFor={id} className={labelClass}>
        Referred by
      </label>
      {value ? (
        <div className="flex items-center justify-between text-sm">
          <span data-testid="referrer-name">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            value={search}
            autoComplete="off"
            placeholder="Search contacts, or type @name"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={results.length > 0 ? listId : undefined}
            aria-activedescendant={results.length > 0 ? `${listId}-${active}` : undefined}
            onChange={(e) => {
              setSearch(e.target.value);
              setActive(0);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => pickerKey(e, results, active, setActive, pick, () => setSearch(""))}
            className={inputClass}
          />
          <PickerList id={listId} results={results} active={active} onPick={pick} />
        </>
      )}
    </div>
  );
}
