import Link from "next/link";
import { Changelog } from "@/components/changelog";

export default function PublicChangelogPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg">Atrium</Link>
        <Link
          href="/login"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Sign in
        </Link>
      </header>
      <main className="max-w-3xl mx-auto p-8">
        <Changelog />
      </main>
    </div>
  );
}
