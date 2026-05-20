"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { downloadCsv } from "@/lib/download";
import { formatHours } from "@/lib/format-duration";
import { Download } from "lucide-react";

interface ReportRow {
  projectId?: string;
  projectName?: string;
  userId?: string;
  name?: string;
  seconds: number;
  billableSeconds: number;
  valueCents: number;
}

interface Report {
  totals: { seconds: number; billableSeconds: number; valueCents: number };
  byProject: ReportRow[];
  byUser: ReportRow[];
}

interface Project {
  id: string;
  name: string;
}

const fmtMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export default function TimeReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    apiFetch<{ data: Project[] } | Project[]>("/projects?limit=200")
      .then((res) => setProjects(Array.isArray(res) ? res : res.data))
      .catch((err) => console.error(err));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const r = await apiFetch<Report>(
        `/time-entries/report?${params.toString()}`,
      );
      setReport(r);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv(): void {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    downloadCsv(`/time-entries/report/export?${params.toString()}`).catch(
      (err) => console.error(err),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold">Time report</h1>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        />
      </div>

      {loading || !report ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border border-[var(--border)] rounded-lg p-4">
              <div className="text-xs text-[var(--muted-foreground)]">
                Total hours
              </div>
              <div className="text-2xl font-semibold">
                {formatHours(report.totals.seconds)}
              </div>
            </div>
            <div className="border border-[var(--border)] rounded-lg p-4">
              <div className="text-xs text-[var(--muted-foreground)]">
                Billable hours
              </div>
              <div className="text-2xl font-semibold text-emerald-700">
                {formatHours(report.totals.billableSeconds)}
              </div>
            </div>
            <div className="border border-[var(--border)] rounded-lg p-4">
              <div className="text-xs text-[var(--muted-foreground)]">
                Total value
              </div>
              <div className="text-2xl font-semibold">
                {fmtMoney(report.totals.valueCents)}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">By project</h2>
            <table className="w-full border border-[var(--border)] rounded-lg text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted-foreground)]">
                  <th className="p-2">Project</th>
                  <th className="p-2">Hours</th>
                  <th className="p-2">Billable</th>
                  <th className="p-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {report.byProject.map((r) => (
                  <tr
                    key={r.projectId}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="p-2">{r.projectName}</td>
                    <td className="p-2">{formatHours(r.seconds)}</td>
                    <td className="p-2">{formatHours(r.billableSeconds)}</td>
                    <td className="p-2">{fmtMoney(r.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">By user</h2>
            <table className="w-full border border-[var(--border)] rounded-lg text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted-foreground)]">
                  <th className="p-2">User</th>
                  <th className="p-2">Hours</th>
                  <th className="p-2">Billable</th>
                  <th className="p-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {report.byUser.map((r) => (
                  <tr
                    key={r.userId}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{formatHours(r.seconds)}</td>
                    <td className="p-2">{formatHours(r.billableSeconds)}</td>
                    <td className="p-2">{fmtMoney(r.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
