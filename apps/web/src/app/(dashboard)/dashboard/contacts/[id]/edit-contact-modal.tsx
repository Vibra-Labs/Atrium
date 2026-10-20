"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { CompanyField, SourceField } from "../contact-fields";
import { NEW_SOURCE, STATUS_LABELS, inputClass } from "../shared";
import type { ContactDetail } from "./types";

interface Option {
  id: string;
  name: string;
}

interface Props {
  contact: ContactDetail;
  onClose: () => void;
  onSaved: () => void;
}

const labelClass = "block text-sm text-[var(--muted-foreground)] mb-1";

export function EditContactModal({ contact, onClose, onSaved }: Props) {
  const { success, error: showError } = useToast();
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [website, setWebsite] = useState(contact.website ?? "");
  const [address, setAddress] = useState(contact.address ?? "");
  const [status, setStatus] = useState(contact.status);
  const [companyText, setCompanyText] = useState(contact.company?.name ?? "");
  const [companyId, setCompanyId] = useState<string | null>(contact.company?.id ?? null);
  const [sourceChoice, setSourceChoice] = useState(contact.leadSource?.id ?? "");
  const [newSource, setNewSource] = useState("");
  const [sources, setSources] = useState<Option[]>([]);
  const [referrer, setReferrer] = useState<Option | null>(contact.referredBy);
  const [referrerSearch, setReferrerSearch] = useState("");
  const [referrerResults, setReferrerResults] = useState<Option[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [sourcesError, setSourcesError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSources = useCallback((): void => {
    setSourcesError(false);
    apiFetch<Option[]>("/lead-sources")
      .then((res) => {
        setSources(res);
        setSourcesLoaded(true);
      })
      .catch((err) => {
        console.error(err);
        setSourcesError(true);
      });
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const sourceName =
    sourceChoice === NEW_SOURCE ? newSource : (sources.find((s) => s.id === sourceChoice)?.name ?? "");
  const isReferral = sourceName.trim().toLowerCase() === "referral";

  useEffect(() => {
    const term = referrerSearch.trim();
    if (!isReferral || !term) {
      setReferrerResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiFetch<{ data: Option[] }>(`/contacts?search=${encodeURIComponent(term)}&limit=6`)
        .then((res) => setReferrerResults(res.data.filter((c) => c.id !== contact.id)))
        .catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [referrerSearch, isReferral, contact.id]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const body: Record<string, string | null> = {
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim(),
      website: website.trim(),
      address: address.trim(),
      status,
      referredById: isReferral ? (referrer?.id ?? null) : null,
    };
    if (companyId) body.companyId = companyId;
    else if (companyText.trim()) body.companyName = companyText.trim();
    else body.companyId = null;
    if (sourceChoice === NEW_SOURCE) {
      if (newSource.trim()) body.leadSourceName = newSource.trim();
    } else {
      body.leadSourceId = sourceChoice || null;
    }
    try {
      await apiFetch(`/contacts/${contact.id}`, { method: "PUT", body: JSON.stringify(body) });
      success("Contact updated");
      onSaved();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to update contact";
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
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-semibold">Edit contact</h3>
        <div>
          <label htmlFor="edit-name" className={labelClass}>Name</label>
          <input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label htmlFor="edit-email" className={labelClass}>Email</label>
          <input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-phone" className={labelClass}>Phone</label>
            <input id="edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="edit-website" className={labelClass}>Website</label>
            <input id="edit-website" value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label htmlFor="edit-address" className={labelClass}>Address</label>
          <input id="edit-address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
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
            <label htmlFor="edit-status" className={labelClass}>Status</label>
            <select id="edit-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        {isReferral && (
          <div className="relative">
            <label htmlFor="edit-referrer" className={labelClass}>Referred by</label>
            {referrer ? (
              <div className="flex items-center justify-between text-sm">
                <span>{referrer.name}</span>
                <button
                  type="button"
                  onClick={() => setReferrer(null)}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  id="edit-referrer"
                  value={referrerSearch}
                  autoComplete="off"
                  placeholder="Search contacts"
                  onChange={(e) => setReferrerSearch(e.target.value)}
                  className={inputClass}
                />
                {referrerResults.length > 0 && (
                  <ul
                    role="listbox"
                    className="absolute z-10 mt-1 w-full bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg text-sm overflow-hidden"
                  >
                    {referrerResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            setReferrer(c);
                            setReferrerSearch("");
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-[var(--muted)]"
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
        {sourcesError && (
          <p className="text-sm text-red-600">
            Couldn&apos;t load lead sources.{" "}
            <button type="button" onClick={loadSources} className="underline">
              Retry
            </button>
          </p>
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
            disabled={saving || !sourcesLoaded || !name.trim() || (sourceChoice === NEW_SOURCE && !newSource.trim())}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
