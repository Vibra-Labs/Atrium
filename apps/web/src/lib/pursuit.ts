// Potential contracts: projects that aren't signed yet.

import { costSummary, pipelineFor, stageLabel } from "@atrium/shared";
import type { CostSummary, PursuitOutcome, PursuitStage } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { useCachedApi } from "@/lib/cached";

export { costSummary, pipelineFor, stageLabel };
export type { CostSummary };
export type { PursuitOutcome, PursuitStage };

export interface PipelineStage {
  id: string;
  name: string;
  slug: string;
  order: number;
}

/** One of the workspace's pipelines with its stages (from GET /pursuit-pipelines). */
export interface Pipeline {
  id: string;
  name: string;
  order: number;
  stages: PipelineStage[];
}

export const PIPELINES_PATH = "/pursuit-pipelines";

/** The workspace's pipelines in order, cached; null while loading. Call invalidate(PIPELINES_PATH) after a change. */
export function usePipelines(): Pipeline[] | null {
  return useCachedApi<Pipeline[]>(PIPELINES_PATH);
}

/** The stages a contract can be in: its pipeline's (the first for an unassigned one), in order. */
export function stagesFor(pipelines: Pipeline[] | null, pipelineId: string | null): PipelineStage[] {
  return [...(pipelineFor(pipelines, pipelineId)?.stages ?? [])].sort((a, b) => a.order - b.order);
}

export interface PursuitEvent {
  id: string;
  text: string;
  createdAt: string;
}

export interface Pursuit {
  projectId: string;
  pipelineId: string | null;
  stage: PursuitStage;
  outcome: PursuitOutcome;
  lostReason: string | null;
  valueCents: number | null;
  closeDate: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  isBid: boolean;
  solicitationNumber: string | null;
  questionsDueAt: string | null;
  sourceUrl: string | null;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  events?: PursuitEvent[];
}

/** A contact linked to the project (from GET /projects/:id). */
export interface ProjectContactRow {
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    userId: string | null;
    status: string;
  };
}

/** A person picked in the contacts card or the Won dialog. */
export interface ContactRef {
  id: string;
  name: string;
  email: string | null;
  hasLogin: boolean;
}

export interface PipelineRow {
  projectId: string;
  name: string;
  pipelineId: string | null;
  stage: PursuitStage;
  valueCents: number | null;
  closeDate: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  isBid: boolean;
  questionsDueAt: string | null;
}

export type PursuitPatch = Partial<
  Pick<
    Pursuit,
    | "pipelineId"
    | "stage"
    | "valueCents"
    | "closeDate"
    | "nextStep"
    | "nextStepAt"
    | "isBid"
    | "solicitationNumber"
    | "questionsDueAt"
    | "sourceUrl"
    | "companyId"
  >
>;

/** Open or lost: not signed work yet. */
export function isUnsigned(p: { pursuit?: Pursuit | null }): boolean {
  return !!p.pursuit && p.pursuit.outcome !== "won";
}

export function contactRef(row: ProjectContactRow): ContactRef {
  const c = row.contact;
  return {
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed",
    email: c.email,
    hasLogin: !!c.userId,
  };
}

/** "2026-11-06T00:00:00.000Z" or "2026-11-06" → "2026-11-06" (calendar day, no timezone shift). */
export function toDay(d: string | null): string | null {
  return d ? d.slice(0, 10) : null;
}

function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDay(d: string | null): string {
  const day: string | null = toDay(d);
  if (!day) return "—";
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function isPast(d: string): boolean {
  return (toDay(d) ?? "") < localDay(0);
}

/** "3 days late" for a past date. Both are calendar days, so there's no timezone shift. */
export function daysLate(d: string, today: string = localDay(0)): string {
  const [y1, m1, d1] = (toDay(d) ?? today).split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  const days: number = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} late`;
}

export interface DueItem {
  projectId: string;
  date: string;
  title: string;
  sub: string;
}

/** Next steps and deadlines in the next seven days, overdue ones included, soonest first. */
export function dueSoon(rows: PipelineRow[]): DueItem[] {
  const to: string = localDay(6);
  const items: DueItem[] = [];
  for (const p of rows) {
    const next: string | null = toDay(p.nextStepAt);
    const questions: string | null = toDay(p.questionsDueAt);
    const close: string | null = toDay(p.closeDate);
    if (next && next <= to) items.push({ projectId: p.projectId, date: next, title: p.nextStep || "Next step", sub: p.name });
    if (p.isBid && questions && questions <= to) {
      items.push({ projectId: p.projectId, date: questions, title: p.name, sub: "Questions due" });
    }
    if (close && close <= to) {
      items.push({ projectId: p.projectId, date: close, title: p.name, sub: p.isBid ? "Bid due" : "Expected close" });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function updatePursuit(projectId: string, patch: PursuitPatch): Promise<Pursuit> {
  return apiFetch<Pursuit>(`/projects/${projectId}/pursuit`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function winPursuit(
  projectId: string,
  body: { contactId?: string; status: string; giveAccess: boolean },
): Promise<{ projectId: string; inviteEmail: string | null; accessFailed: boolean }> {
  return apiFetch(`/projects/${projectId}/pursuit/win`, { method: "POST", body: JSON.stringify(body) });
}

export function losePursuit(projectId: string, reason: string): Promise<void> {
  return apiFetch(`/projects/${projectId}/pursuit/lose`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function reopenPursuit(projectId: string): Promise<void> {
  return apiFetch(`/projects/${projectId}/pursuit/reopen`, { method: "POST" });
}

/** The link only if it's a normal web address, so a stored "javascript:" URL never becomes clickable. */
export function webLink(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** "45000.5" -> "45,000.5". Keeps a trailing "." so you can keep typing cents. */
export function withCommas(raw: string): string {
  const clean: string = raw.replace(/[^\d.]/g, "");
  const [whole, ...rest] = clean.split(".");
  const grouped: string = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${grouped}.${rest.join("").slice(0, 2)}` : grouped;
}

export function toCents(text: string): number | null {
  const n: number = Number(text.replace(/,/g, ""));
  return text === "" || Number.isNaN(n) ? null : Math.round(n * 100);
}

/* Cost and margin */

export interface CostLine {
  id: string;
  label: string;
  amountCents: number;
}

export interface ContractCosts {
  costCents: number | null;
  laborRateCents: number | null;
  trackedSeconds: number;
  lines: CostLine[];
  summary: CostSummary;
}

const costsPath = (projectId: string): string => `/projects/${projectId}/costs`;

export function getCosts(projectId: string): Promise<ContractCosts> {
  return apiFetch<ContractCosts>(costsPath(projectId));
}

export function updateCosts(
  projectId: string,
  patch: { costCents?: number | null; laborRateCents?: number | null },
): Promise<ContractCosts> {
  return apiFetch<ContractCosts>(costsPath(projectId), { method: "PATCH", body: JSON.stringify(patch) });
}

export function addCostLine(projectId: string, line: { label: string; amountCents: number }): Promise<ContractCosts> {
  return apiFetch<ContractCosts>(`${costsPath(projectId)}/lines`, { method: "POST", body: JSON.stringify(line) });
}

export function updateCostLine(
  projectId: string,
  lineId: string,
  patch: { label?: string; amountCents?: number },
): Promise<ContractCosts> {
  return apiFetch<ContractCosts>(`${costsPath(projectId)}/lines/${lineId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function removeCostLine(projectId: string, lineId: string): Promise<ContractCosts> {
  return apiFetch<ContractCosts>(`${costsPath(projectId)}/lines/${lineId}`, { method: "DELETE" });
}
