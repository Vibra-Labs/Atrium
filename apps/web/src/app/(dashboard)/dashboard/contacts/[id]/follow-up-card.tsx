"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { createLatestSaver } from "@/lib/latest-saver";
import { useToast } from "@/components/toast";
import { inputClass } from "../shared";

const REPEAT_OPTIONS: { days: number; label: string }[] = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
];
const SNOOZE_DAYS = [1, 3, 7];

/** ISO timestamp -> local "YYYY-MM-DD" for a date input. */
function toLocalDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Local "YYYY-MM-DD" -> ISO timestamp of local midnight. */
function localMidnightIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

interface FollowUpDraft {
  contactId: string;
  date: string;
  repeat: number | null;
}

interface Props {
  contactId: string;
  followUpAt: string | null;
  everyDays: number | null;
  onChanged: () => void;
}

export function FollowUpCard({ contactId, followUpAt, everyDays, onChanged }: Props) {
  const { error: showError } = useToast();
  const [date, setDate] = useState(toLocalDate(followUpAt));
  const [repeat, setRepeat] = useState<number | null>(everyDays);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // What the inputs show right now; every save sends all of it, never a stale half.
  const draft = useRef<{ date: string; repeat: number | null }>({
    date: toLocalDate(followUpAt),
    repeat: everyDays,
  });
  const callbacks = useRef({ onChanged, showError });

  useEffect(() => {
    callbacks.current = { onChanged, showError };
  }, [onChanged, showError]);

  useEffect(() => {
    setDate(toLocalDate(followUpAt));
    setRepeat(everyDays);
    draft.current = { date: toLocalDate(followUpAt), repeat: everyDays };
  }, [followUpAt, everyDays]);

  // Blur on the date and change on the repeat select fire back to back; saves run one at a
  // time and the last one always carries the latest date and repeat.
  const [saveDraft] = useState(() =>
    createLatestSaver<FollowUpDraft>(
      async ({ contactId: id, date: nextDate, repeat: nextRepeat }) => {
        try {
          await apiFetch(`/contacts/${id}/follow-up`, {
            method: "PUT",
            body: JSON.stringify({
              followUpAt: nextDate ? localMidnightIso(nextDate) : null,
              everyDays: nextDate ? nextRepeat : null,
            }),
          });
        } catch (err) {
          console.error(err);
          callbacks.current.showError(err instanceof Error ? err.message : "Failed to save follow-up");
        }
      },
      () => callbacks.current.onChanged(),
    ),
  );

  async function run(path: string, init: RequestInit, failure: string): Promise<void> {
    try {
      await apiFetch(`/contacts/${contactId}/follow-up${path}`, init);
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : failure);
    }
  }

  function save(): Promise<void> {
    return saveDraft({ contactId, ...draft.current });
  }

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
        Follow-up
      </h2>
      <div className="space-y-2">
        <input
          type="date"
          aria-label="Follow-up date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            draft.current = { ...draft.current, date: e.target.value };
          }}
          onBlur={() => {
            if (draft.current.date !== toLocalDate(followUpAt)) save();
          }}
          className={inputClass}
        />
        <select
          aria-label="Repeat"
          value={repeat ?? ""}
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null;
            setRepeat(next);
            draft.current = { ...draft.current, repeat: next };
            if (draft.current.date) save();
          }}
          className={inputClass}
        >
          <option value="">Does not repeat</option>
          {REPEAT_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              Every {o.label}
            </option>
          ))}
        </select>
        {followUpAt && (
          <div className="flex items-center gap-3 text-sm relative">
            <button
              onClick={() => run("/done", { method: "POST" }, "Failed to complete follow-up")}
              className="px-3 py-1 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]"
            >
              Done
            </button>
            <button
              onClick={() => setSnoozeOpen((o) => !o)}
              className="px-3 py-1 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]"
            >
              Snooze
            </button>
            <button
              onClick={() => {
                setDate("");
                setRepeat(null);
                draft.current = { date: "", repeat: null };
                save();
              }}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Clear
            </button>
            {snoozeOpen && (
              <ul className="absolute top-full left-0 mt-1 z-10 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden">
                {SNOOZE_DAYS.map((days) => (
                  <li key={days}>
                    <button
                      onClick={() => {
                        setSnoozeOpen(false);
                        run(
                          "/snooze",
                          { method: "POST", body: JSON.stringify({ days }) },
                          "Failed to snooze follow-up",
                        );
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--muted)]"
                    >
                      {days === 1 ? "1 day" : `${days} days`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
