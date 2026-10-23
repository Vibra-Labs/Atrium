"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { ProjectDetailSkeleton } from "@/components/skeletons";
import { AddContactModal } from "../../add-contact-modal";
import { RevenueStrip } from "../../[id]/revenue-strip";
import type { Revenue } from "../../[id]/types";
import { STATUS_LABELS, inputClass } from "../../shared";
import { useRowLink } from "@/lib/use-row-link";

interface CompanyDetail {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  annualRevenue: number | null;
  employeeCount: number | null;
  people: { id: string; name: string; email: string | null; status: string }[];
  revenue: Revenue;
}

const LIST_URL = "/dashboard/contacts?tab=companies";
const buttonClass =
  "px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors";
const fieldLabelClass = "block text-sm text-[var(--muted-foreground)] mb-1";

// Annual revenue is a rough figure the user types, so it's shown as a plain number.
const numberFormat = new Intl.NumberFormat();

/** "" = clear (null); otherwise the whole number typed. */
function wholeNumber(value: string): number | null {
  return value.trim() === "" ? null : Math.trunc(Number(value));
}

function toInput(value: number | null): string {
  return value == null ? "" : String(value);
}

function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error: showError } = useToast();
  const rowLink = useRowLink();
  const confirm = useConfirm();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [annualRevenue, setAnnualRevenue] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiFetch<CompanyDetail>(`/companies/${id}`);
      setCompany(res);
      setNotes(res.notes ?? "");
      setLoadFailed(false);
    } catch (err) {
      console.error(err);
      // apiFetch exposes only the API message, so match the 404 text.
      if (err instanceof Error && err.message === "Company not found") setNotFound(true);
      else setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(body: Record<string, string | number | null>, failure: string): Promise<boolean> {
    try {
      await apiFetch(`/companies/${id}`, { method: "PUT", body: JSON.stringify(body) });
      await load();
      return true;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
      return false;
    }
  }

  function startEditing(): void {
    if (!company) return;
    setName(company.name);
    setWebsite(company.website ?? "");
    setAnnualRevenue(toInput(company.annualRevenue));
    setEmployeeCount(toInput(company.employeeCount));
    setEditing(true);
  }

  async function saveDetails(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const ok = await update(
      {
        name: name.trim(),
        website: website.trim() || null,
        annualRevenue: wholeNumber(annualRevenue),
        employeeCount: wholeNumber(employeeCount),
      },
      "Failed to update company",
    );
    setSaving(false);
    if (ok) {
      success("Company updated");
      setEditing(false);
    }
  }

  async function saveNotes(): Promise<void> {
    if (!company || notes === (company.notes ?? "")) return;
    if (await update({ notes: notes.trim() || null }, "Failed to save notes")) success("Notes saved");
  }

  async function remove(): Promise<void> {
    if (!company) return;
    const ok = await confirm({
      title: "Delete company",
      message: `Delete ${company.name}? Its people stay as contacts, without a company.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/companies/${company.id}`, { method: "DELETE" });
      router.push(LIST_URL);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to delete company");
    }
  }

  if (loading) return <ProjectDetailSkeleton />;
  if (loadFailed && !company) {
    return (
      <div className="py-12 text-center space-y-2">
        <p className="text-[var(--muted-foreground)]">Couldn&apos;t load this company.</p>
        <button
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="text-sm hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  if (notFound || !company) {
    return (
      <div className="py-12 text-center space-y-2">
        <p className="text-[var(--muted-foreground)]">Company not found.</p>
        <Link href={LIST_URL} className="text-sm hover:underline">
          Back to companies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href={LIST_URL} className="text-sm text-[var(--muted-foreground)] hover:underline">
        ‹ Companies
      </Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {editing ? (
          <form onSubmit={saveDetails} className="flex items-end gap-2 flex-wrap">
            <div>
              <label htmlFor="company-name" className={fieldLabelClass}>
                Name
              </label>
              <input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="company-website" className={fieldLabelClass}>
                Website
              </label>
              <input
                id="company-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="company-revenue" className={fieldLabelClass}>
                Annual revenue
              </label>
              <input
                id="company-revenue"
                type="number"
                min={0}
                max={2000000000}
                step={1}
                value={annualRevenue}
                onChange={(e) => setAnnualRevenue(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="company-employees" className={fieldLabelClass}>
                No. of employees
              </label>
              <input
                id="company-employees"
                type="number"
                min={0}
                max={2000000000}
                step={1}
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold">{company.name}</h1>
              {company.website && (
                <a
                  href={websiteHref(company.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--muted-foreground)] hover:underline"
                >
                  {company.website}
                </a>
              )}
              {(company.annualRevenue != null || company.employeeCount != null) && (
                <dl data-testid="company-size" className="flex gap-4 text-sm text-[var(--muted-foreground)] mt-1">
                  {company.annualRevenue != null && (
                    <div className="flex gap-1">
                      <dt>Annual revenue:</dt>
                      <dd className="text-[var(--foreground)]">{numberFormat.format(company.annualRevenue)}</dd>
                    </div>
                  )}
                  {company.employeeCount != null && (
                    <div className="flex gap-1">
                      <dt>Employees:</dt>
                      <dd className="text-[var(--foreground)]">{numberFormat.format(company.employeeCount)}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={startEditing} className={buttonClass}>
                Edit
              </button>
              <button onClick={remove} className={`${buttonClass} text-red-600`}>
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      <RevenueStrip revenue={company.revenue} />

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              People
            </h2>
            <button
              onClick={() => setAdding(true)}
              className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              + Add person
            </button>
          </div>
          {company.people.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No people yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
              {company.people.map((p) => (
                <li
                  key={p.id}
                  {...rowLink(`/dashboard/contacts/${p.id}`)}
                  className="cursor-pointer flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[var(--muted)]"
                >
                  <div className="min-w-0">
                    <Link href={`/dashboard/contacts/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.email && (
                      <p className="text-xs text-[var(--muted-foreground)] truncate">{p.email}</p>
                    )}
                  </div>
                  <span className="inline-flex px-2 py-0.5 rounded-full bg-[var(--muted)] text-xs font-medium">
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="md:border-l md:border-[var(--border)] md:pl-4">
          <label
            htmlFor="company-notes"
            className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2"
          >
            Notes
          </label>
          <textarea
            id="company-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={6}
            maxLength={5000}
            className={inputClass}
          />
        </aside>
      </div>

      {adding && (
        <AddContactModal
          company={{ id: company.id, name: company.name }}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}
