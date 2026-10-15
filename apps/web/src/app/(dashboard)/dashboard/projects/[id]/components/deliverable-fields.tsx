"use client";

const INPUT = "w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm";

export function AskApprovalCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--primary)]" />
      <span className="text-sm">Ask client to approve</span>
    </label>
  );
}

export function DeliverableFields({
  idPrefix,
  note,
  onNoteChange,
  reminders,
  onRemindersChange,
}: {
  idPrefix: string;
  note: string;
  onNoteChange: (v: string) => void;
  reminders: boolean;
  onRemindersChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-note`} className="text-sm text-[var(--muted-foreground)]">Note to client</label>
        <textarea id={`${idPrefix}-note`} value={note} onChange={(e) => onNoteChange(e.target.value)} maxLength={500} rows={3} placeholder="Optional" className={INPUT} />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={reminders} onChange={(e) => onRemindersChange(e.target.checked)} className="accent-[var(--primary)]" />
        <span className="text-sm">Remind the client after 3 days</span>
      </label>
    </>
  );
}
