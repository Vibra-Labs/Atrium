"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { isSafeOAuthRedirect } from "@/lib/safe-redirect";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

const MAX_CLIENT_NAME_LENGTH = 60;

/** Client names come from OPEN dynamic client registration; cap what we render. */
function truncateClientName(name: string): string {
  return name.length > MAX_CLIENT_NAME_LENGTH
    ? `${name.slice(0, MAX_CLIENT_NAME_LENGTH)}…`
    : name;
}

interface ConsentInfo {
  client: { clientId: string; name: string };
  organizations: { id: string; name: string }[];
}

interface ConsentFormProps {
  clientId: string;
  consentCode: string;
}

export function ConsentForm({ clientId, consentCode }: ConsentFormProps): React.ReactElement {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [organizationId, setOrganizationId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<ConsentInfo>(`/mcp-grants/consent-info?clientId=${encodeURIComponent(clientId)}`)
      .then((data) => {
        setInfo(data);
        if (data.organizations.length > 0) setOrganizationId(data.organizations[0].id);
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(err instanceof Error ? err.message : "Could not load this request");
      });
  }, [clientId]);

  const respond = async (accept: boolean): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (accept) {
        await apiFetch("/mcp-grants", {
          method: "POST",
          body: JSON.stringify({ clientId, organizationId }),
        });
      }
      const res = await fetch(`${API_URL}/api/auth/oauth2/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirectURI?: string; message?: string };
      if (!res.ok || !data.redirectURI) throw new Error(data.message || "Could not complete the request");
      if (!isSafeOAuthRedirect(data.redirectURI)) {
        throw new Error("This app registered an unsafe redirect address. The connection was cancelled.");
      }
      window.location.href = data.redirectURI;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  if (error && !info) return <p className="text-sm text-red-600">{error}</p>;
  if (!info) return <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>;

  const canAllow: boolean = info.organizations.length > 0;
  const workspaceName: string =
    info.organizations.find((o) => o.id === organizationId)?.name ?? "your workspace";
  const clientName: string = truncateClientName(info.client.name);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold break-words">Connect {clientName} to Atrium</h1>

      {canAllow ? (
        <>
          <p className="text-sm text-[var(--muted-foreground)] break-words">
            <strong>{clientName}</strong> will be able to view and manage projects, clients, tasks,
            updates, and notes in <strong>{workspaceName}</strong>, acting as you. You can disconnect it
            at any time in Settings → API &amp; MCP.
          </p>

          {info.organizations.length > 1 && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Workspace</span>
              <select
                aria-label="Workspace"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
              >
                {info.organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Only workspace owners and admins can connect AI assistants. Your account is not an owner or
          admin of any workspace.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {canAllow && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void respond(true)}
            className="flex-1 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Allow
          </button>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void respond(false)}
          className="flex-1 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
