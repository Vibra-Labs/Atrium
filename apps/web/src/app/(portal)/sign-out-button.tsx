"use client";

import { LogOut } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function SignOutButton() {
  const handleSignOut = async () => {
    await fetch(`${API_URL}/api/auth/sign-out`, {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/login";
  };

  return (
    <button
      onClick={handleSignOut}
      aria-label="Sign out"
      className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[var(--muted)] text-sm text-[var(--muted-foreground)] shrink-0"
    >
      <LogOut size={16} />
      <span className="hidden sm:inline">Sign Out</span>
    </button>
  );
}
