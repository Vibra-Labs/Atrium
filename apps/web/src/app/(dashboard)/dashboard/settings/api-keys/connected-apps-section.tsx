"use client";

import { useEffect, useState } from "react";
import { Plug, Unplug } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";

interface GrantSummary {
  id: string;
  clientName: string;
  organizationName: string;
  userName: string;
  createdAt: string;
  mine: boolean;
}

export function ConnectedAppsSection(): React.ReactElement {
  const [grants, setGrants] = useState<GrantSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const { success, error: showError } = useToast();
  const confirm = useConfirm();

  const load = (): void => {
    apiFetch<GrantSummary[]>("/mcp-grants")
      .then((data) => setGrants(data))
      .catch((err: unknown) => {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to load connected apps");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = async (grant: GrantSummary): Promise<void> => {
    const ok = await confirm({
      title: "Disconnect app",
      message: `Disconnect "${grant.clientName}"? It will lose access immediately and must sign in again to reconnect.`,
      confirmLabel: "Disconnect",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/mcp-grants/${grant.id}`, { method: "DELETE" });
      success("App disconnected");
      load();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to disconnect app");
    }
  };

  return (
    <section className="space-y-4 py-8">
      <div className="flex items-center gap-2">
        <Plug size={18} />
        <h2 className="text-base font-semibold">Connected apps</h2>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        AI assistants that were connected by signing in. Each acts as the person who connected it.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No connected apps.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--muted-foreground)]">
              <tr>
                <th className="py-2 font-medium">App</th>
                <th className="py-2 font-medium">Connected by</th>
                <th className="py-2 font-medium">Connected</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{grant.clientName}</td>
                  <td className="py-2">{grant.mine ? "You" : grant.userName}</td>
                  <td className="py-2">{new Date(grant.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void disconnect(grant)}
                      className="inline-flex items-center gap-1 text-red-600 hover:underline"
                    >
                      <Unplug size={14} /> Disconnect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
