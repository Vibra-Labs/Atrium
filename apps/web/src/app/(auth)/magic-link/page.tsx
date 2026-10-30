"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { magicLinkVerifyUrl } from "@/lib/magic-link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// The emailed sign-in link lands here, not on the API: mail scanners open
// every link they see, and only a person presses the button.
function MagicLinkContent() {
  const [signingIn, setSigningIn] = useState(false);
  const searchParams = useSearchParams();
  const verifyUrl: string | null = magicLinkVerifyUrl(searchParams.toString(), API_URL);

  if (!verifyUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">Invalid sign-in link</h1>
          <p className="text-[var(--muted-foreground)]">
            This link is incomplete. Request a new one from the sign-in page.
          </p>
          <Link href="/login" className="text-[var(--primary)] hover:underline">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            Press the button to finish signing in.
          </p>
        </div>
        <button
          type="button"
          disabled={signingIn}
          onClick={() => {
            setSigningIn(true);
            window.location.href = verifyUrl;
          }}
          className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {signingIn ? "Signing in..." : "Continue"}
        </button>
      </div>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense>
      <MagicLinkContent />
    </Suspense>
  );
}
