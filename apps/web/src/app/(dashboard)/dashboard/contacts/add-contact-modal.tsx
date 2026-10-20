"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";

interface Company {
  id: string;
  name: string;
}

interface LeadSource {
  id: string;
  name: string;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const NEW_SOURCE = "__new__";
const inputClass =
  "w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";

export function AddContactModal({ onClose, onCreated }: Props) {
  const { success, error: showError } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("lead");
  const [companyText, setCompanyText] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [sourceChoice, setSourceChoice] = useState("");
  const [newSource, setNewSource] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ data: Company[] }>("/companies?limit=100")
      .then((res) => setCompanies(res.data))
      .catch(console.error);
    apiFetch<LeadSource[]>("/lead-sources").then(setSources).catch(console.error);
  }, []);

  const matches = companies
    .filter((c) => c.name.toLowerCase().includes(companyText.trim().toLowerCase()))
    .slice(0, 6);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const body: Record<string, string> = { name: name.trim(), status };
    if (email.trim()) body.email = email.trim();
    if (companyId) body.companyId = companyId;
    else if (companyText.trim()) body.companyName = companyText.trim();
    if (sourceChoice === NEW_SOURCE) {
      if (newSource.trim()) body.leadSourceName = newSource.trim();
    } else if (sourceChoice) {
      body.leadSourceId = sourceChoice;
    }
    try {
      await apiFetch("/contacts", { method: "POST", body: JSON.stringify(body) });
      success("Contact added");
      onCreated();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to add contact";
      setError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md mx-4 p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold">Add contact</h3>
        <div>
          <label htmlFor="contact-name" className="block text-sm text-[var(--muted-foreground)] mb-1">
            Name
          </label>
          <input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="contact-email" className="block text-sm text-[var(--muted-foreground)] mb-1">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="relative">
          <label htmlFor="contact-company" className="block text-sm text-[var(--muted-foreground)] mb-1">
            Company
          </label>
          <input
            id="contact-company"
            value={companyText}
            autoComplete="off"
            onChange={(e) => {
              setCompanyText(e.target.value);
              setCompanyId(null);
              setCompanyOpen(true);
            }}
            onFocus={() => setCompanyOpen(true)}
            onBlur={() => setTimeout(() => setCompanyOpen(false), 150)}
            className={inputClass}
          />
          {companyOpen && companyText.trim() && (
            <ul
              role="listbox"
              className="absolute z-10 mt-1 w-full bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg text-sm overflow-hidden"
            >
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={companyId === c.id}
                    onMouseDown={() => {
                      setCompanyText(c.name);
                      setCompanyId(c.id);
                      setCompanyOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--muted)]"
                  >
                    {c.name}
                  </button>
                </li>
              ))}
              {!companies.some((c) => c.name.toLowerCase() === companyText.trim().toLowerCase()) && (
                <li className="px-3 py-2 text-[var(--muted-foreground)]">
                  Create “{companyText.trim()}”
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="contact-source" className="block text-sm text-[var(--muted-foreground)] mb-1">
              Source
            </label>
            <select
              id="contact-source"
              value={sourceChoice}
              onChange={(e) => setSourceChoice(e.target.value)}
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
          <div>
            <label htmlFor="contact-status" className="block text-sm text-[var(--muted-foreground)] mb-1">
              Status
            </label>
            <select
              id="contact-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass}
            >
              <option value="lead">Lead</option>
              <option value="client">Client</option>
              <option value="past_client">Past client</option>
            </select>
          </div>
        </div>
        {sourceChoice === NEW_SOURCE && (
          <input
            aria-label="New source name"
            placeholder="New source name"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            className={inputClass}
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40"
          >
            {saving ? "Adding..." : "Add contact"}
          </button>
        </div>
      </form>
    </div>
  );
}
