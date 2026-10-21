"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { splitFullName } from "@/lib/contact-fields";
import {
  CompanyField,
  MoreFields,
  PhonesField,
  RatingField,
  SocialLinksField,
  SourceField,
  cleanLinks,
  cleanPhones,
} from "../contact-fields";
import { NEW_SOURCE, PHONE_LABELS, STATUS_LABELS, inputClass, labelClass } from "../shared";
import type { ContactPhone } from "../shared";
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

type Body = Record<string, string | null | string[] | ContactPhone[]>;

export function EditContactModal({ contact, onClose, onSaved }: Props) {
  const { success, error: showError } = useToast();
  // Contacts created before first/last names existed are split until the backfill runs.
  const fallback = splitFullName(contact.name);
  const [firstName, setFirstName] = useState(contact.firstName ?? fallback.firstName);
  const [lastName, setLastName] = useState(contact.firstName ? (contact.lastName ?? "") : fallback.lastName);
  const [email, setEmail] = useState(contact.email ?? "");
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? "");
  const [department, setDepartment] = useState(contact.department ?? "");
  const [phones, setPhones] = useState<ContactPhone[]>(
    contact.phones.length ? contact.phones : [{ label: PHONE_LABELS[0], number: "" }],
  );
  const [links, setLinks] = useState<string[]>(contact.socialLinks.length ? contact.socialLinks : [""]);
  const [rating, setRating] = useState(contact.rating ?? "");
  const [website, setWebsite] = useState(contact.website ?? "");
  const [address, setAddress] = useState(contact.address ?? "");
  const [description, setDescription] = useState<string>(contact.description ?? "");
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
  // Imports set a referrer whatever the source is, so one that exists is always shown and kept.
  const showReferrer: boolean = isReferral || contact.referredBy !== null;

  useEffect(() => {
    const term = referrerSearch.trim();
    if (!showReferrer || !term) {
      setReferrerResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiFetch<{ data: Option[] }>(`/contacts?search=${encodeURIComponent(term)}&limit=6`)
        .then((res) => setReferrerResults(res.data.filter((c) => c.id !== contact.id)))
        .catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [referrerSearch, showReferrer, contact.id]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!firstName.trim()) return;
    setSaving(true);
    setError("");
    const body: Body = {
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      jobTitle: jobTitle.trim() || null,
      department: department.trim() || null,
      phones: cleanPhones(phones),
      socialLinks: cleanLinks(links),
      rating: rating || null,
      website: website.trim(),
      address: address.trim(),
      description: description.trim(),
      status,
    };
    // Only sent when changed here, so saving never drops a referrer by accident.
    const referrerId: string | null = referrer?.id ?? null;
    if (referrerId !== (contact.referredBy?.id ?? null)) body.referredById = referrerId;
    // A portal client's email comes from their account and can't be changed here.
    if (!contact.hasLogin) body.email = email.trim() || null;
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
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-lg font-semibold">Edit contact</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-first-name" className={labelClass}>First name</label>
            <input
              id="edit-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              maxLength={99}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="edit-last-name" className={labelClass}>Last name</label>
            <input
              id="edit-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={99}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="edit-email" className={labelClass}>Email</label>
          <input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={contact.hasLogin}
            aria-describedby={contact.hasLogin ? "edit-email-hint" : undefined}
            className={`${inputClass}${contact.hasLogin ? " opacity-60 cursor-not-allowed" : ""}`}
          />
          {contact.hasLogin && (
            <p id="edit-email-hint" className="mt-1 text-xs text-[var(--muted-foreground)]">
              This email comes from their portal account.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <CompanyField
            text={companyText}
            onChange={(text, id) => {
              setCompanyText(text);
              setCompanyId(id);
            }}
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
        <PhonesField idPrefix="edit" phones={phones} onChange={setPhones} />
        <MoreFields
          filled={
            [jobTitle, department, website, address, description, sourceChoice, rating].filter((v) => v.trim()).length +
            (cleanLinks(links).length > 0 ? 1 : 0) +
            (referrer ? 1 : 0)
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-job-title" className={labelClass}>Job title</label>
              <input
                id="edit-job-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={200}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="edit-department" className={labelClass}>Department</label>
              <input
                id="edit-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={100}
                className={inputClass}
              />
            </div>
          </div>
          <SocialLinksField links={links} onChange={setLinks} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-website" className={labelClass}>Website</label>
              <input id="edit-website" value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="edit-address" className={labelClass}>Address</label>
              <input id="edit-address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="edit-description" className={labelClass}>About</label>
            <textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SourceField
              sources={sources}
              choice={sourceChoice}
              newSource={newSource}
              onChoice={setSourceChoice}
              onNewSource={setNewSource}
            />
            <RatingField id="edit-rating" value={rating} onChange={setRating} />
          </div>
          {showReferrer && (
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
        </MoreFields>
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
            disabled={saving || !sourcesLoaded || !firstName.trim() || (sourceChoice === NEW_SOURCE && !newSource.trim())}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
