"use client";

// UI for potential contracts: projects that aren't signed yet.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, ExternalLink, Trophy, User, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAppConfig } from "@/lib/app-config";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import {
  PURSUIT_STAGES,
  PURSUIT_STAGE_LABELS,
  contactRef,
  dueSoon,
  formatDay,
  isPast,
  losePursuit,
  toDay,
  updatePursuit,
  winPursuit,
} from "@/lib/pursuit";
import type { ContactRef, PipelineRow, ProjectContactRow, Pursuit, PursuitPatch } from "@/lib/pursuit";

const input =
  "w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-60";
const label = "block text-xs text-[var(--muted-foreground)] mb-1";
/** Keyboard focus shows a ring in the brand color instead of the browser's outline. */
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";
const btn = `px-3 py-2 border border-[var(--border)] rounded-lg text-sm whitespace-nowrap hover:bg-[var(--muted)] transition-colors disabled:opacity-40 ${focusRing}`;
const primaryBtn = `px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-sm whitespace-nowrap hover:opacity-90 disabled:opacity-40 ${focusRing}`;
const cardTitle = "text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]";

function useMoney(): (cents: number | null) => string {
  const config = useAppConfig();
  return (cents) => (cents === null ? "—" : formatCurrency(cents, config?.currency));
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const pressedOnBackdrop = useRef<boolean>(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      onMouseDown={(e) => (pressedOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-[var(--background)] border border-[var(--border)] p-5 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`text-[var(--muted-foreground)] rounded ${focusRing}`}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ New project type ------------------------------ */

export type NewKind = "project" | "pursuit";

export function KindPicker({ value, onChange }: { value: NewKind; onChange: (k: NewKind) => void }) {
  const options: { id: NewKind; label: string; hint: string }[] = [
    { id: "project", label: "Project", hint: "Signed work" },
    { id: "pursuit", label: "Potential contract", hint: "Not signed yet" },
  ];
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 min-w-[8rem] text-left px-3 py-2 rounded-lg border text-sm ${focusRing} ${
            value === o.id ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)]"
          }`}
        >
          <span className="font-medium block">{o.label}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ List badge ------------------------------ */

export function PursuitBadge({ p }: { p: Pursuit }) {
  const money = useMoney();
  if (p.outcome === "won") return null;
  const text: string = p.outcome === "lost" ? "Lost" : PURSUIT_STAGE_LABELS[p.stage];
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <span
        data-testid="pursuit-badge"
        className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
          p.outcome === "lost"
            ? "bg-[var(--muted)] text-[var(--muted-foreground)] line-through"
            : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
        }`}
      >
        {text}
      </span>
      {p.outcome === "open" && (p.valueCents !== null || p.nextStep) && (
        <span
          className="text-xs text-[var(--muted-foreground)] whitespace-nowrap max-w-[12rem] truncate"
          title={p.nextStep ?? undefined}
        >
          {p.valueCents !== null && money(p.valueCents)}
          {p.valueCents !== null && p.nextStep && " · "}
          {p.nextStep && `Next: ${p.nextStep}${p.nextStepAt ? ` ${formatDay(p.nextStepAt)}` : ""}`}
        </span>
      )}
    </div>
  );
}

/* ------------------------------ Stage bar ------------------------------ */

export function PursuitPipeline({
  p,
  onChanged,
  onWon,
  onLost,
  onReopen,
}: {
  p: Pursuit;
  onChanged: () => void;
  onWon: () => void;
  onLost: () => void;
  onReopen: () => void | Promise<void>;
}) {
  const { error: showError } = useToast();
  const [reopening, setReopening] = useState<boolean>(false);

  async function setStage(stage: Pursuit["stage"]): Promise<void> {
    try {
      await updatePursuit(p.projectId, { stage });
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to change the stage");
    }
  }

  if (p.outcome === "lost") {
    return (
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--muted)]">
          Lost{p.lostReason ? ` · ${p.lostReason}` : ""}
        </span>
        <button
          onClick={async () => {
            setReopening(true);
            try {
              await onReopen();
            } finally {
              setReopening(false);
            }
          }}
          disabled={reopening}
          className="text-xs text-[var(--primary)] hover:underline disabled:opacity-50"
        >
          {reopening ? "Reopening..." : "Reopen"}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-[var(--muted-foreground)] mr-1">Potential contract</span>
      {PURSUIT_STAGES.map((stage) => (
        <button
          key={stage}
          data-testid="pursuit-stage"
          aria-pressed={p.stage === stage}
          onClick={() => p.stage !== stage && setStage(stage)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            p.stage === stage ? "bg-amber-500 text-white" : "bg-[var(--muted)] text-[var(--foreground)]"
          }`}
        >
          {PURSUIT_STAGE_LABELS[stage]}
        </button>
      ))}
      <span className="w-px h-5 bg-[var(--border)] mx-1" />
      <button
        onClick={onWon}
        className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-600 text-white hover:opacity-90 flex items-center gap-1"
      >
        <Trophy size={12} /> Won
      </button>
      <button onClick={onLost} className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--muted)] hover:opacity-80">
        Lost
      </button>
    </div>
  );
}

/* ------------------------------ Deal card ------------------------------ */

/** "45000.5" -> "45,000.5". Keeps a trailing "." so you can keep typing cents. */
function withCommas(raw: string): string {
  const clean: string = raw.replace(/[^\d.]/g, "");
  const [whole, ...rest] = clean.split(".");
  const grouped: string = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${grouped}.${rest.join("").slice(0, 2)}` : grouped;
}

function toCents(text: string): number | null {
  const n: number = Number(text.replace(/,/g, ""));
  return text === "" || Number.isNaN(n) ? null : Math.round(n * 100);
}

/** Date field that keeps what you type and saves only a whole date (or a cleared field when you leave it). */
function DateField({
  value,
  onSave,
  disabled,
  ariaLabel,
}: {
  value: string | null;
  onSave: (v: string | null) => Promise<boolean>;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const saved: string = toDay(value) ?? "";
  const [text, setText] = useState<string>(saved);
  // The last value sent, so leaving the field right after a save doesn't send it again.
  const sent = useRef<string>(saved);
  useEffect(() => {
    setText(saved);
    sent.current = saved;
  }, [saved]);

  async function commit(next: string): Promise<void> {
    if (next === sent.current) return;
    sent.current = next;
    if (!(await onSave(next || null))) {
      sent.current = saved;
      setText(saved);
    }
  }

  return (
    <input
      type="date"
      aria-label={ariaLabel}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        // Typing a year goes 0002, 0020, 0202, 2026; only a real year is worth saving straight away.
        if (Number(e.target.value.slice(0, 4)) >= 1900) commit(e.target.value);
      }}
      onBlur={() => commit(text)}
      className={input}
    />
  );
}

/** Text field that saves when you leave it, and only if it changed. */
function SavedText({
  value,
  onSave,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string | null;
  onSave: (v: string | null) => Promise<boolean>;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState<string>(value ?? "");
  return (
    <input
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        const next: string | null = text.trim() || null;
        if (next === (value ?? null)) return;
        if (!(await onSave(next))) setText(value ?? "");
      }}
      placeholder={placeholder}
      className={input}
    />
  );
}

export function DealCard({ p, readOnly, onChanged }: { p: Pursuit; readOnly: boolean; onChanged: () => void }) {
  const money = useMoney();
  const { error: showError } = useToast();
  const savedValueText: string = p.valueCents === null ? "" : withCommas(String(p.valueCents / 100));
  const [valueText, setValueText] = useState<string>(savedValueText);

  /** Returns false when the save was rejected, so the field can go back to the saved value. */
  async function save(patch: PursuitPatch): Promise<boolean> {
    try {
      await updatePursuit(p.projectId, patch);
      onChanged();
      return true;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to save");
      return false;
    }
  }

  const dateField = (key: "closeDate" | "nextStepAt" | "questionsDueAt", aria: string) => (
    <DateField ariaLabel={aria} value={p[key]} disabled={readOnly} onSave={(v) => save({ [key]: v })} />
  );

  return (
    <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-3">
      <h2 className={cardTitle}>{readOnly ? "Deal" : "Potential contract"}</h2>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>Value</label>
          <input
            aria-label="Value"
            inputMode="decimal"
            disabled={readOnly}
            value={valueText}
            onChange={(e) => setValueText(withCommas(e.target.value))}
            onBlur={async () => {
              const cents: number | null = toCents(valueText);
              if (cents === null) setValueText("");
              if (cents === p.valueCents) return;
              if (!(await save({ valueCents: cents }))) setValueText(savedValueText);
            }}
            placeholder={money(0)}
            className={input}
          />
        </div>
        <div>
          <label className={label}>{p.isBid ? "Bid due" : "Expected close"}</label>
          {dateField("closeDate", p.isBid ? "Bid due" : "Expected close")}
        </div>
      </div>
      <div>
        <label className={label}>Next step</label>
        <div className="space-y-2">
          <SavedText
            ariaLabel="Next step"
            value={p.nextStep}
            disabled={readOnly}
            onSave={(nextStep) => save({ nextStep })}
            placeholder="Follow up Friday"
          />
          {dateField("nextStepAt", "Next step date")}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={p.isBid}
          disabled={readOnly}
          onChange={(e) => save({ isBid: e.target.checked })}
        />
        Formal bid <span className="text-xs text-[var(--muted-foreground)]">(RFP, RFQ)</span>
      </label>
      {p.isBid && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>Solicitation #</label>
              <SavedText
                ariaLabel="Solicitation number"
                value={p.solicitationNumber}
                disabled={readOnly}
                onSave={(solicitationNumber) => save({ solicitationNumber })}
              />
            </div>
            <div>
              <label className={label}>Questions due</label>
              {dateField("questionsDueAt", "Questions due")}
            </div>
          </div>
          <div>
            <label className={label}>Posting link</label>
            <div className="flex gap-2">
              <SavedText
                ariaLabel="Posting link"
                value={p.sourceUrl}
                disabled={readOnly}
                onSave={(sourceUrl) => save({ sourceUrl })}
                placeholder="https://"
              />
              {p.sourceUrl && (
                <a href={p.sourceUrl} target="_blank" rel="noreferrer" className={btn} aria-label="Open posting">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        </>
      )}
      {p.events && p.events.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">History</summary>
          <ul className="mt-2 space-y-1">
            {p.events.map((e) => (
              <li key={e.id} className="flex gap-2 text-xs">
                <span className="text-[var(--muted-foreground)] w-12 shrink-0">
                  {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ------------------------------ Contact search ------------------------------ */

interface Row {
  id: string;
  name: string;
  email?: string | null;
  hasLogin?: boolean;
}

function Picker({
  kind,
  onPick,
  exclude = [],
}: {
  kind: "contact" | "company";
  onPick: (ref: ContactRef) => void;
  exclude?: string[];
}) {
  const { error: showError } = useToast();
  const [q, setQ] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState<"loading" | "done" | "failed">("loading");
  const [creating, setCreating] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const plural: string = kind === "contact" ? "contacts" : "companies";

  useEffect(() => {
    setSearch("loading");
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "6" });
      if (q.trim()) params.set("search", q.trim());
      apiFetch<{ data: Row[] }>(`/${plural}?${params}`)
        .then((res) => {
          setRows(res.data.filter((r) => !exclude.includes(r.id)));
          setSearch("done");
        })
        .catch((err: unknown) => {
          console.error(err);
          setRows([]);
          setSearch("failed");
        });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind]);

  async function create(): Promise<void> {
    setBusy(true);
    try {
      if (kind === "contact") {
        const [firstName, ...rest] = q.trim().split(" ");
        const c = await apiFetch<Row>("/contacts", {
          method: "POST",
          body: JSON.stringify({
            firstName,
            ...(rest.length ? { lastName: rest.join(" ") } : {}),
            ...(email.trim() ? { email: email.trim() } : {}),
            status: "lead",
          }),
        });
        onPick({ id: c.id, name: q.trim(), email: email.trim() || null, hasLogin: false });
      } else {
        const c = await apiFetch<Row>("/companies", { method: "POST", body: JSON.stringify({ name: q.trim() }) });
        onPick({ id: c.id, name: c.name, email: null, hasLogin: false });
      }
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : `Failed to create ${kind}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={kind === "contact" ? "Search or type a new name" : "Search or type a new company"}
        className={input}
        autoFocus
      />
      {creating ? (
        <div className="space-y-2">
          {kind === "contact" && (
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className={input} />
          )}
          <div className="flex gap-2">
            <button className={primaryBtn} disabled={!q.trim() || busy} onClick={create}>
              {busy ? "Creating..." : `Create ${kind === "contact" ? "lead" : "company"}`}
            </button>
            <button className={btn} onClick={() => setCreating(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] max-h-52 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--muted)] ${focusRing}`}
                  onClick={() => onPick({ id: r.id, name: r.name, email: r.email ?? null, hasLogin: !!r.hasLogin })}
                >
                  {r.name}
                  {r.email && <span className="text-xs text-[var(--muted-foreground)] ml-2">{r.email}</span>}
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
                {search === "loading" ? "Searching..." : search === "failed" ? `Couldn't load ${plural}` : "No matches"}
              </li>
            )}
          </ul>
          {q.trim() && (
            <button className="text-sm text-[var(--primary)] hover:underline" onClick={() => setCreating(true)}>
              + Create &ldquo;{q.trim()}&rdquo;
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Contacts card ------------------------------ */

/** Replaces the Clients card while the project is unsigned: people linked, nobody invited. */
export function PursuitContactsCard({
  p,
  contacts,
  onChanged,
}: {
  p: Pursuit;
  contacts: ProjectContactRow[];
  onChanged: () => void;
}) {
  const { error: showError } = useToast();
  const [adding, setAdding] = useState<"contact" | "company" | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const people: ContactRef[] = contacts.map(contactRef);
  const editable: boolean = p.outcome === "open";

  async function run(action: () => Promise<unknown>, failure: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setAdding(null);
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  // A plain link (shows on the contact's page); it gives no portal access.
  const link = (ref: ContactRef) =>
    run(() => apiFetch(`/contacts/${ref.id}/projects/${p.projectId}`, { method: "POST" }), "Failed to link contact");
  const unlink = (id: string) =>
    run(() => apiFetch(`/contacts/${id}/projects/${p.projectId}`, { method: "DELETE" }), "Failed to unlink contact");
  const setCompany = (companyId: string | null) =>
    run(() => updatePursuit(p.projectId, { companyId }), "Failed to link company");

  return (
    <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-3">
      <h2 className={cardTitle}>Contacts</h2>
      {people.length === 0 && !p.company && (
        <p className="text-sm text-[var(--muted-foreground)] italic">No contact yet</p>
      )}
      <ul className="space-y-2 text-sm">
        {p.company && (
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <Building2 size={14} className="text-[var(--muted-foreground)] shrink-0" />
              <Link href={`/dashboard/contacts/companies/${p.company.id}`} className="hover:underline truncate">
                {p.company.name}
              </Link>
            </span>
            {editable && (
              <button
                className="text-xs text-[var(--muted-foreground)] hover:underline disabled:opacity-50"
                disabled={busy}
                aria-label={`Remove ${p.company.name}`}
                onClick={() => setCompany(null)}
              >
                Remove
              </button>
            )}
          </li>
        )}
        {people.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <User size={14} className="text-[var(--muted-foreground)] shrink-0" />
              <Link href={`/dashboard/contacts/${c.id}`} className="hover:underline truncate">
                {c.name}
              </Link>
            </span>
            {editable && (
              <button
                className="text-xs text-[var(--muted-foreground)] hover:underline disabled:opacity-50"
                disabled={busy}
                aria-label={`Remove ${c.name}`}
                onClick={() => unlink(c.id)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex gap-3 text-xs">
          <button className="text-[var(--primary)] hover:underline" onClick={() => setAdding("contact")}>
            + Contact
          </button>
          {!p.company && (
            <button className="text-[var(--primary)] hover:underline" onClick={() => setAdding("company")}>
              + Company
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-[var(--muted-foreground)]">
        Not invited. Nobody sees this project in the portal until it&apos;s won and you give them access.
      </p>
      {adding && (
        <Modal title={adding === "contact" ? "Link a contact" : "Link a company"} onClose={() => setAdding(null)}>
          <Picker
            kind={adding}
            exclude={people.map((c) => c.id)}
            onPick={(ref) => (adding === "contact" ? link(ref) : setCompany(ref.id))}
          />
        </Modal>
      )}
    </section>
  );
}

/* ------------------------------ Won / Lost ------------------------------ */

interface Status {
  slug: string;
  name: string;
}

export function WonDialog({
  projectId,
  projectName,
  contacts,
  statuses,
  onClose,
  onDone,
}: {
  projectId: string;
  projectName: string;
  contacts: ProjectContactRow[];
  statuses: Status[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { success, error: showError } = useToast();
  const linked: ContactRef[] = contacts.map(contactRef);
  const [client, setClient] = useState<ContactRef | null>(linked[0] ?? null);
  const [picking, setPicking] = useState<boolean>(linked.length === 0);
  const active: Status[] = statuses.filter((s) => s.slug !== "cancelled" && s.slug !== "completed");
  const defaultStatus: string = active.find((s) => s.slug === "in_progress")?.slug ?? active[0]?.slug ?? "";
  const [status, setStatus] = useState<string>(defaultStatus);
  // Statuses can arrive after the dialog opens.
  useEffect(() => {
    if (!status && defaultStatus) setStatus(defaultStatus);
  }, [status, defaultStatus]);
  const [giveAccess, setGiveAccess] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const canGiveAccess: boolean = !!client && (client.hasLogin || !!client.email);
  // Why "Mark won" is disabled, if it is (besides saving).
  const blocker: string | null = !client || picking ? "Pick the client" : !status ? "Loading statuses..." : null;

  async function confirm(): Promise<void> {
    if (!client) return;
    setSaving(true);
    try {
      const result = await winPursuit(projectId, { contactId: client.id, status, giveAccess: giveAccess && canGiveAccess });
      success(`Won. ${client.name} is now a client`);
      if (result.inviteEmail) {
        // Accepting this invite gives them the project (the API remembered it at the win).
        try {
          await apiFetch("/auth/organization/invite-member", {
            method: "POST",
            body: JSON.stringify({ email: result.inviteEmail, role: "member" }),
          });
          success(`Portal invite sent to ${result.inviteEmail}`);
        } catch (err) {
          console.error(err);
          showError(
            `Won, but the invite failed: ${err instanceof Error ? err.message : "unknown error"}. Invite them from Contacts.`,
          );
        }
      }
      onDone();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to mark won");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Won: ${projectName}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <p className="font-medium">Who&apos;s the client?</p>
          {picking ? (
            <>
              {linked.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {linked.map((c) => (
                    <button
                      key={c.id}
                      className={btn}
                      onClick={() => {
                        setClient(c);
                        setPicking(false);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <Picker
                kind="contact"
                onPick={(ref) => {
                  setClient(ref);
                  setPicking(false);
                }}
              />
            </>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
              <span>
                <span className="font-medium">{client?.name}</span> becomes a <span className="font-medium">Client</span>
              </span>
              <button className="text-xs text-[var(--primary)] hover:underline" onClick={() => setPicking(true)}>
                Change
              </button>
            </div>
          )}
        </div>
        <div>
          <label className={label} htmlFor="won-status">
            Project status
          </label>
          <select id="won-status" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
            {active.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className={`flex items-start gap-2 ${canGiveAccess ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={giveAccess && canGiveAccess}
            disabled={!canGiveAccess}
            onChange={(e) => setGiveAccess(e.target.checked)}
            className={`mt-1 rounded ${focusRing}`}
          />
          <span>
            <span className="font-medium">{client?.hasLogin ? "Give portal access now" : "Invite to the portal now"}</span>
            <span className="block text-[var(--muted-foreground)]">
              {!client
                ? "Pick the client first."
                : !canGiveAccess
                  ? "This contact has no email."
                  : "Off by default. Everything added so far stays internal; you can share items later."}
            </span>
          </span>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        {blocker && <span className="mr-auto text-xs text-[var(--muted-foreground)]">{blocker}</span>}
        <button onClick={onClose} className={btn}>
          Cancel
        </button>
        <button onClick={confirm} disabled={blocker !== null || saving} className={primaryBtn}>
          {saving ? "Saving..." : "Mark won"}
        </button>
      </div>
    </Modal>
  );
}

export function LostDialog({
  projectId,
  projectName,
  onClose,
  onDone,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { error: showError } = useToast();
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  async function confirm(): Promise<void> {
    setSaving(true);
    try {
      await losePursuit(projectId, reason.trim());
      onDone();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to mark lost");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Mark "${projectName}" lost`} onClose={onClose}>
      <div>
        <label className={label} htmlFor="lost-reason">
          Reason (optional)
        </label>
        <input
          id="lost-reason"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Price, timing, went with another vendor..."
          className={input}
        />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        It&apos;s archived, so it moves off your active list. Find it again with &ldquo;Show archived&rdquo;. You can reopen
        it any time.
      </p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btn}>
          Cancel
        </button>
        <button onClick={confirm} disabled={saving} className={primaryBtn}>
          Mark lost
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ Dashboard card ------------------------------ */

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PipelineCard() {
  const money = useMoney();
  const [rows, setRows] = useState<PipelineRow[] | null>(null);

  useEffect(() => {
    apiFetch<PipelineRow[]>("/projects/pipeline")
      .then(setRows)
      .catch((err: unknown) => {
        console.error(err);
        setRows([]);
      });
  }, []);

  if (!rows || rows.length === 0) return null;
  const value: number = rows.reduce((sum, p) => sum + (p.valueCents ?? 0), 0);
  const due = dueSoon(rows).slice(0, 6);
  return (
    <section
      data-testid="pipeline-card"
      className="p-4 sm:p-5 border border-[var(--border)] rounded-2xl bg-[var(--background)] space-y-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm sm:text-base font-semibold">Pipeline</h2>
        <Link
          href="/dashboard/projects?status=pursuit"
          className="text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1"
        >
          Potential contracts <ChevronRight size={13} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Chasing</p>
          <p className="text-lg font-bold">{money(value)}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--muted-foreground)]">Open</p>
          <p className="text-lg font-bold">{plural(rows.length, "contract")}</p>
        </div>
      </div>
      {due.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">Nothing due in the next seven days.</p>
      ) : (
        <ul className="space-y-2.5">
          {due.map((d, i) => (
            <li key={`${d.projectId}-${i}`} className="flex items-center gap-3">
              <span
                className={`w-14 text-[11px] font-semibold shrink-0 ${isPast(d.date) ? "text-rose-600 dark:text-rose-400" : "text-[var(--muted-foreground)]"}`}
              >
                {isPast(d.date) ? "Overdue" : formatDay(d.date)}
              </span>
              <div className="min-w-0">
                <Link
                  href={`/dashboard/projects/${d.projectId}`}
                  className="block text-xs font-semibold truncate hover:text-[var(--primary)]"
                >
                  {d.title}
                </Link>
                <span className="block text-[11px] text-[var(--muted-foreground)] truncate">{d.sub}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
