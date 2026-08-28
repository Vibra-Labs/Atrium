"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

export type SwitchableOrg = {
  id: string;
  name: string;
  slug?: string | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * Organization identity in the sidebar, doubling as a switcher when the user
 * belongs to more than one org.
 *
 * Switching sends the user back to /dashboard rather than keeping them where
 * they were: project and client ids are scoped to an organization, so a route
 * like /dashboard/projects/<id> is meaningless in the org being switched to.
 */
export function OrgSwitcher({
  orgs,
  activeOrgId,
  orgName,
  logoSrc,
  hideLogo,
}: {
  orgs: SwitchableOrg[];
  activeOrgId: string | null;
  orgName: string | null;
  logoSrc: string | null;
  hideLogo?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // A single-org user gets plain text — a dropdown that only ever lists the
  // org you are already in is noise.
  const canSwitch = orgs.length > 1;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function switchTo(organizationId: string): Promise<void> {
    if (organizationId === activeOrgId) {
      setOpen(false);
      return;
    }
    setSwitching(organizationId);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/organization/set-active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) throw new Error(`set-active failed (${res.status})`);
      setOpen(false);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("Failed to switch organization", err);
      setError("Could not switch. Try again.");
    } finally {
      setSwitching(null);
    }
  }

  const label = (
    <>
      {!hideLogo && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={logoSrc || "/icon.png"}
          alt=""
          className="h-7 w-7 object-contain shrink-0"
        />
      )}
      <span className="font-bold text-lg leading-none truncate">
        {orgName || "Atrium"}
      </span>
    </>
  );

  if (!canSwitch) {
    return <div className="flex items-center gap-2.5 min-w-0 flex-1">{label}</div>;
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch organization"
        className="flex items-center gap-2.5 min-w-0 w-full rounded-lg px-1 py-1 -mx-1 hover:bg-[var(--muted)] transition-colors"
      >
        {label}
        <ChevronsUpDown
          size={14}
          className="shrink-0 text-[var(--muted-foreground)]"
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-50 w-60 rounded-lg border border-[var(--border)] bg-[var(--background)] p-1 shadow-lg"
        >
          {orgs.map((org) => (
            <button
              key={org.id}
              type="button"
              role="option"
              aria-selected={org.id === activeOrgId}
              disabled={switching !== null}
              onClick={() => switchTo(org.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-[var(--muted)] disabled:opacity-60"
            >
              <Check
                size={14}
                className={org.id === activeOrgId ? "opacity-100" : "opacity-0"}
              />
              <span className="truncate">{org.name}</span>
              {switching === org.id && (
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                  …
                </span>
              )}
            </button>
          ))}

          <div className="my-1 border-t border-[var(--border)]" />

          <Link
            href="/dashboard/settings/organizations"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--muted)]"
          >
            <Plus size={14} />
            New organization
          </Link>

          {error && (
            <p className="px-2 py-1.5 text-xs text-[var(--destructive)]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
