"use client";

// Catches unexpected errors during branded login page rendering (e.g. API
// unreachable). The not-found case is handled by notFound() in the page itself.
export default function BrandedLoginError() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-2">
        <p className="text-sm font-medium">Something went wrong</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Unable to load the login page. Please try again later.
        </p>
      </div>
    </div>
  );
}
