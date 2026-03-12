import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold tracking-tight flex items-center justify-center gap-3">
          <Image src="/icon.png" alt="Atrium logo" width={56} height={56} />
          Atrium
        </h1>
        <p className="text-xl text-[var(--muted-foreground)] max-w-md">
          The open-source client portal for agencies and freelancers.
        </p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="px-6 py-3 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          Sign In
        </Link>
        <Link
          href="/signup"
          className="px-6 py-3 border border-[var(--border)] rounded-lg font-medium hover:bg-[var(--muted)] transition-colors"
        >
          Get Started
        </Link>
      </div>
    </div>
  );
}
