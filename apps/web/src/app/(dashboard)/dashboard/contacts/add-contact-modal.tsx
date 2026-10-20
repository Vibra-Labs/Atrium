"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { CompanyField, SourceField } from "./contact-fields";
import { NEW_SOURCE, inputClass } from "./shared";

interface LeadSource {
  id: string;
  name: string;
}

interface Props {
  company?: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}

export function AddContactModal({ company, onClose, onCreated }: Props) {
  const { success, error: showError } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("lead");
  const [companyText, setCompanyText] = useState(company?.name ?? "");
  const [companyId, setCompanyId] = useState<string | null>(company?.id ?? null);
  const [sourceChoice, setSourceChoice] = useState("");
  const [newSource, setNewSource] = useState("");
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<LeadSource[]>("/lead-sources").then(setSources).catch(console.error);
  }, []);

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
        <CompanyField
          text={companyText}
          onChange={(text, id) => {
            setCompanyText(text);
            setCompanyId(id);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <SourceField
            sources={sources}
            choice={sourceChoice}
            newSource={newSource}
            onChoice={setSourceChoice}
            onNewSource={setNewSource}
          />
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
            disabled={saving || !name.trim() || (sourceChoice === NEW_SOURCE && !newSource.trim())}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40"
          >
            {saving ? "Adding..." : "Add contact"}
          </button>
        </div>
      </form>
    </div>
  );
}
