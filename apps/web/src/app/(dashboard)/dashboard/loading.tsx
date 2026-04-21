export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-7 w-48 rounded bg-[var(--muted)]" />
      <div className="h-4 w-80 rounded bg-[var(--muted)]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-32 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40"
          />
        ))}
      </div>
    </div>
  );
}
