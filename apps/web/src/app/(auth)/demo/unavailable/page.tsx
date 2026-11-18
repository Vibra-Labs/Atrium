import Link from "next/link";

/** Where a failed demo sign-in lands, instead of silently bouncing to /login. */
export default function DemoUnavailablePage(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-bold">The demo is unavailable</h1>
        <p className="text-[var(--muted-foreground)]">
          The demo workspace may be resetting. Try again in a moment, or start a free workspace of
          your own.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/demo" className="text-[var(--primary)] hover:underline">
            Try the demo again
          </Link>
          <Link href="/signup?ref=demo" className="text-[var(--primary)] hover:underline">
            Start free
          </Link>
        </div>
      </div>
    </div>
  );
}
