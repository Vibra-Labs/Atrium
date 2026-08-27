"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Organization {
  id: string;
  name: string;
  slug?: string | null;
}

/**
 * Slugs are unique across the deploy, so two agencies both called "Acme"
 * would collide. Signup solves this with a random suffix
 * (see OnboardingController.signup); do the same here.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

export default function OrganizationsSettingsPage(): React.ReactElement {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch(`${API_URL}/api/auth/organization/list`, {
          credentials: "include",
        }),
        fetch(`${API_URL}/api/auth/organization/get-full-organization`, {
          credentials: "include",
        }),
      ]);
      if (listRes.ok) {
        const data = await listRes.json();
        setOrgs(Array.isArray(data) ? data : []);
      }
      if (activeRes.ok) {
        const active = await activeRes.json();
        setActiveId(active?.id ?? null);
      }
    } catch (err) {
      console.error("Failed to load organizations", err);
      setError("Could not load your organizations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createOrg(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/organization/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed, slug: slugify(trimmed) }),
      });

      if (!res.ok) {
        // The API refuses portal clients and locked-down deploys; both surface
        // here rather than as a silent no-op.
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Create failed (${res.status})`);
      }

      const created = await res.json();
      if (created?.id) {
        await fetch(`${API_URL}/api/auth/organization/set-active`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ organizationId: created.id }),
        });
      }
      setName("");
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("Failed to create organization", err);
      setError(
        err instanceof Error ? err.message : "Could not create organization.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function switchTo(organizationId: string): Promise<void> {
    if (organizationId === activeId) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/organization/set-active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) throw new Error(`set-active failed (${res.status})`);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("Failed to switch organization", err);
      setError("Could not switch organization.");
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Organizations</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Every organization you belong to. Each keeps its own projects,
            clients and branding.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {orgs.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => switchTo(org.id)}
                  disabled={org.id === activeId}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-[var(--muted)] disabled:hover:bg-transparent"
                >
                  <Check
                    size={16}
                    className={
                      org.id === activeId ? "opacity-100" : "opacity-0"
                    }
                  />
                  <span className="truncate">{org.name}</span>
                  {org.id === activeId && (
                    <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                      Current
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Create an organization</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Run a second company from this same Atrium. You become its owner.
          </p>
        </div>

        <form onSubmit={createOrg} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company name"
            aria-label="Organization name"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            <Plus size={16} />
            {creating ? "Creating…" : "Create"}
          </button>
        </form>

        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
      </section>
    </div>
  );
}
