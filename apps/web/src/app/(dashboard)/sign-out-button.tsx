"use client";

import { LogOut } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function SignOutButton() {
  const handleSignOut = async () => {
    await fetch(`${API_URL}/api/auth/sign-out`, {
      method: "POST",
      credentials: "include",
    });
    window.location.href = "/portal/sign-in";
  };

  return (
    <button
      onClick={handleSignOut}
      className="flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--muted)] text-sm text-[var(--muted-foreground)]"
    >
      <LogOut size={18} />
      Sign Out
    </button>
  );
}
