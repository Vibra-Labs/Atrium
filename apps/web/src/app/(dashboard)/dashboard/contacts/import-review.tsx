import { RATING_LABELS, STATUS_LABELS } from "./shared";
import type { ContactPhone } from "./shared";

export interface RowNote {
  row: number;
  reason: string;
}

export interface ImportSample {
  row: number;
  name: string;
  email: string | null;
  company: string | null;
  phones: ContactPhone[];
  status: string;
  rating: string | null;
  tags: string[];
  followUpAt: string | null;
  referredBy: string | null;
}

/** Response of POST /contacts/import/check. */
export interface ImportCheck {
  total: number;
  toCreate: number;
  skipped: RowNote[];
  warnings: RowNote[];
  sample: ImportSample[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 contacts will be created · 2 rows skipped · 1 warning" */
export function checkSummary(check: ImportCheck): string {
  const parts = [`${plural(check.toCreate, "contact", "contacts")} will be created`];
  if (check.skipped.length) parts.push(`${plural(check.skipped.length, "row", "rows")} skipped`);
  if (check.warnings.length) parts.push(plural(check.warnings.length, "warning", "warnings"));
  return parts.join(" · ");
}

/** Status, rating, tags, follow-up and referrer of a sample row, as one short line. */
export function sampleDetails(s: ImportSample): string {
  const parts = [STATUS_LABELS[s.status] ?? s.status];
  if (s.rating) parts.push(RATING_LABELS[s.rating] ?? s.rating);
  if (s.tags.length) parts.push(s.tags.join(", "));
  if (s.followUpAt) parts.push(`Follow up ${s.followUpAt}`);
  if (s.referredBy) parts.push(`Referred by ${s.referredBy}`);
  return parts.join(" · ");
}

export function RowNotes({ title, notes, testId }: { title: string; notes: RowNote[]; testId: string }) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <ul data-testid={testId} className="text-sm text-[var(--muted-foreground)] space-y-1 max-h-40 overflow-y-auto">
        {notes.map((n, i) => (
          <li key={`${n.row}-${i}`}>
            Row {n.row}: {n.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the import will do, before anything is written. */
export function ImportReview({ check }: { check: ImportCheck }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium" data-testid="import-summary">
        {checkSummary(check)}
      </p>
      {check.sample.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-[var(--muted-foreground)]">
            {check.toCreate > check.sample.length ? `First ${check.sample.length} of them:` : "Contacts to create:"}
          </p>
          <div className="border border-[var(--border)] rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Phones</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {check.sample.map((s) => (
                  <tr key={s.row} data-testid="import-sample-row" className="border-b border-[var(--border)] last:border-0 align-top">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{s.name}</td>
                    <td className="px-3 py-2">{s.email ?? "—"}</td>
                    <td className="px-3 py-2">{s.company ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {s.phones.length
                        ? s.phones.map((p) => (
                            <div key={p.number}>
                              <span className="text-[var(--muted-foreground)]">{p.label}:</span> {p.number}
                            </div>
                          ))
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted-foreground)]">{sampleDetails(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <RowNotes title="Will be skipped" notes={check.skipped} testId="import-check-skipped" />
      <RowNotes title="Will be imported with something left out" notes={check.warnings} testId="import-check-warnings" />
    </div>
  );
}
