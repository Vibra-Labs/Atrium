import Link from "next/link";

export default function ReportsIndex() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <ul className="space-y-2">
        <li>
          <Link
            href="/dashboard/reports/time"
            className="text-[var(--primary)] hover:underline"
          >
            Time report →
          </Link>
        </li>
      </ul>
    </div>
  );
}
