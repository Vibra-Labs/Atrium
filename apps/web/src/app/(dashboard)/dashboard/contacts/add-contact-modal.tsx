"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import {
  CompanyField,
  MoreFields,
  PhonesField,
  RatingField,
  SocialLinksField,
  SourceField,
  cleanLinks,
  cleanPhones,
} from "./contact-fields";
import { NEW_SOURCE, PHONE_LABELS, STATUS_LABELS, inputClass, labelClass } from "./shared";
import type { ContactPhone } from "./shared";
import { MentionTextarea, ReferrerField, toNoteContent } from "./mentions";
import type { PickedContact } from "./mentions";
import { invalidate, useCachedApi } from "@/lib/cached";

interface LeadSource {
  id: string;
  name: string;
}

interface Props {
  company?: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}

type Body = Record<string, string | string[] | ContactPhone[]>;

export function AddContactModal({ company, onClose, onCreated }: Props) {
  const { success, error: showError } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [phones, setPhones] = useState<ContactPhone[]>([{ label: PHONE_LABELS[0], number: "" }]);
  const [links, setLinks] = useState<string[]>([""]);
  const [status, setStatus] = useState("lead");
  const [rating, setRating] = useState("");
  const [note, setNote] = useState("");
  const [mentions, setMentions] = useState<PickedContact[]>([]);
  const [referrer, setReferrer] = useState<PickedContact | null>(null);
  const [companyText, setCompanyText] = useState(company?.name ?? "");
  const [companyId, setCompanyId] = useState<string | null>(company?.id ?? null);
  const [sourceChoice, setSourceChoice] = useState("");
  const [newSource, setNewSource] = useState("");
  const sources: LeadSource[] = useCachedApi<LeadSource[]>("/lead-sources") ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!firstName.trim()) return;
    setSaving(true);
    setError("");
    const body: Body = {
      firstName: firstName.trim(),
      status,
      phones: cleanPhones(phones),
      socialLinks: cleanLinks(links),
    };
    if (lastName.trim()) body.lastName = lastName.trim();
    if (email.trim()) body.email = email.trim();
    if (jobTitle.trim()) body.jobTitle = jobTitle.trim();
    if (department.trim()) body.department = department.trim();
    if (rating) body.rating = rating;
    if (companyId) body.companyId = companyId;
    else if (companyText.trim()) body.companyName = companyText.trim();
    if (sourceChoice === NEW_SOURCE) {
      if (newSource.trim()) body.leadSourceName = newSource.trim();
    } else if (sourceChoice) {
      body.leadSourceId = sourceChoice;
    }
    if (referrer) {
      body.referredById = referrer.id;
      // Someone referred them, so with no source picked the source is a referral.
      if (!sourceChoice) body.leadSourceName = "Referral";
    }
    let contact: { id: string };
    try {
      contact = await apiFetch<{ id: string }>("/contacts", { method: "POST", body: JSON.stringify(body) });
      // A new or "Referral" source name may have created a lead source.
      if (body.leadSourceName) invalidate("/lead-sources");
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to add contact";
      setError(message);
      showError(message);
      setSaving(false);
      return;
    }
    // The contact exists either way; a failed note shouldn't lose it.
    const content = note.trim();
    if (content) {
      try {
        await apiFetch(`/contacts/${contact.id}/notes`, {
          method: "POST",
          body: JSON.stringify({ content: toNoteContent(content, mentions) }),
        });
      } catch (err) {
        console.error(err);
        showError("Contact added, but the note couldn't be saved");
      }
    }
    success("Contact added");
    setSaving(false);
    onCreated();
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
        <h3 className="text-lg font-semibold">Add contact</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="contact-first-name" className={labelClass}>
              First name
            </label>
            <input
              id="contact-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoFocus
              required
              maxLength={99}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="contact-last-name" className={labelClass}>
              Last name
            </label>
            <input
              id="contact-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={99}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="contact-email" className={labelClass}>
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
        <div className="grid grid-cols-2 gap-3">
          <CompanyField
            text={companyText}
            onChange={(text, id) => {
              setCompanyText(text);
              setCompanyId(id);
            }}
          />
          <div>
            <label htmlFor="contact-status" className={labelClass}>
              Status
            </label>
            <select
              id="contact-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <PhonesField idPrefix="contact" phones={phones} onChange={setPhones} />
        <MoreFields
          filled={
            [jobTitle, department, sourceChoice, rating, note].filter((v) => v.trim()).length +
            (cleanLinks(links).length > 0 ? 1 : 0) +
            (referrer ? 1 : 0)
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="contact-job-title" className={labelClass}>
                Job title
              </label>
              <input
                id="contact-job-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={200}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="contact-department" className={labelClass}>
                Department
              </label>
              <input
                id="contact-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={100}
                className={inputClass}
              />
            </div>
          </div>
          <SocialLinksField links={links} onChange={setLinks} />
          <div className="grid grid-cols-2 gap-3">
            <SourceField
              sources={sources}
              choice={sourceChoice}
              newSource={newSource}
              onChoice={setSourceChoice}
              onNewSource={setNewSource}
            />
            <RatingField id="contact-rating" value={rating} onChange={setRating} />
          </div>
          <ReferrerField id="contact-referrer" value={referrer} onChange={setReferrer} />
          <div>
            <label htmlFor="contact-note" className={labelClass}>
              Note <span className="text-xs">(optional)</span>
            </label>
            <MentionTextarea
              id="contact-note"
              value={note}
              onChange={setNote}
              mentions={mentions}
              onMentionsChange={setMentions}
              placeholder="Type @ to mention a contact"
              rows={3}
              maxLength={5000}
              className={inputClass}
            />
          </div>
        </MoreFields>
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
            disabled={saving || !firstName.trim() || (sourceChoice === NEW_SOURCE && !newSource.trim())}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40"
          >
            {saving ? "Adding..." : "Add contact"}
          </button>
        </div>
      </form>
    </div>
  );
}
