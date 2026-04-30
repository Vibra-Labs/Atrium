"use client";

import { useEffect, useState, useRef } from "react";
import { Eye, X } from "lucide-react";
import { Tooltip } from "@/components/tooltip";

interface ClientMember {
  id: string;
  userId: string;
  user: { id: string; name: string; email: string };
}

export function ClientAssignment({
  clients,
  assignedIds,
  onToggle,
  onRemove,
  onPreview,
  disabled,
}: {
  clients: ClientMember[];
  assignedIds: Set<string>;
  onToggle: (userId: string) => void;
  onRemove: (userId: string) => void;
  onPreview?: (
    userId: string,
    clientName: string,
    clientEmail: string,
  ) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const query = search.toLowerCase();
  const filtered = clients.filter(
    (c) =>
      c.user.name.toLowerCase().includes(query) ||
      c.user.email.toLowerCase().includes(query),
  );

  const assignedClients = clients.filter((c) => assignedIds.has(c.userId));

  return (
    <div>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2">
        Clients{assignedIds.size > 0 && ` (${assignedIds.size})`}
      </h2>

      {clients.length > 0 ? (
        <div ref={containerRef} className="relative">
          <div
            className={`flex flex-wrap gap-1.5 min-h-[34px] px-2.5 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] ${disabled ? "opacity-60" : "cursor-text"}`}
            onClick={() => {
              if (disabled) return;
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            {assignedClients.map((c) => {
              const canRemove = !disabled;
              const canPreview = !!onPreview;
              const hasActions = canRemove || canPreview;
              return (
                <span
                  key={c.userId}
                  className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 bg-[var(--muted)] rounded text-xs font-medium"
                >
                  <span>{c.user.name}</span>
                  {hasActions && (
                    <span className="inline-flex items-center gap-0.5 pl-1.5 border-l border-[var(--border)]">
                      {canPreview && (
                        <Tooltip label="View as customer">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreview!(c.userId, c.user.name, c.user.email);
                            }}
                            className="inline-flex items-center justify-center p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--background)] transition-colors"
                            aria-label={`View portal as ${c.user.name}`}
                          >
                            <Eye size={14} />
                          </button>
                        </Tooltip>
                      )}
                      {canRemove && (
                        <Tooltip label="Remove from project">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(c.userId);
                            }}
                            className="inline-flex items-center justify-center p-1 rounded text-[var(--muted-foreground)] hover:text-red-600 hover:bg-[var(--background)] transition-colors"
                            aria-label={`Remove ${c.user.name} from project`}
                          >
                            <X size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </span>
                  )}
                </span>
              );
            })}
            {!disabled && (
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setOpen(true)}
                placeholder={assignedClients.length === 0 ? "Search clients..." : ""}
                className="flex-1 min-w-[100px] bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
              />
            )}
          </div>

          {open && !disabled && (
            <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto border border-[var(--border)] rounded-lg bg-[var(--background)] shadow-lg">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
                  No clients found.
                </div>
              ) : (
                filtered.map((c) => {
                  const selected = assignedIds.has(c.userId);
                  return (
                    <button
                      key={c.userId}
                      type="button"
                      onClick={() => {
                        onToggle(c.userId);
                        setSearch("");
                        inputRef.current?.focus();
                      }}
                      className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm hover:bg-[var(--muted)] transition-colors"
                    >
                      <span
                        className="flex items-center justify-center w-4 h-4 rounded border border-[var(--border)] text-xs shrink-0"
                        style={{
                          backgroundColor: selected ? "var(--primary)" : "transparent",
                          borderColor: selected ? "var(--primary)" : undefined,
                          color: selected ? "#fff" : "transparent",
                        }}
                      >
                        {selected ? "\u2713" : ""}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.user.name}</div>
                        <div className="text-[var(--muted-foreground)] truncate">
                          {c.user.email}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)] pb-4">
          No clients yet. Invite clients from the{" "}
          <a
            href="/dashboard/clients"
            className="text-[var(--primary)] hover:underline"
          >
            Clients page
          </a>
          .
        </p>
      )}

      {assignedIds.size > 0 && (
        <p className="text-xs text-[var(--muted-foreground)] mt-2">
          {assignedIds.size === 1
            ? "This client will"
            : "These clients will"}{" "}
          see this project in their portal.
        </p>
      )}
    </div>
  );
}
