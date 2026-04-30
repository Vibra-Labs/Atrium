"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "atrium:previewAs";

export interface PreviewModeState {
  clientId: string;
  clientName: string;
  clientEmail: string;
}

interface PreviewModeContextValue {
  preview: PreviewModeState | null;
  exitPreview: () => void;
}

const PreviewModeContext = createContext<PreviewModeContextValue>({
  preview: null,
  exitPreview: () => {},
});

interface MemberRecord {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

interface PaginatedResponse<T> {
  data: T[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function readStored(): PreviewModeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PreviewModeState) : null;
  } catch {
    return null;
  }
}

function writeStored(state: PreviewModeState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (state) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.error("preview-mode storage write failed", err);
  }
}

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preview, setPreview] = useState<PreviewModeState | null>(() =>
    readStored(),
  );

  useEffect(() => {
    const requestedId = searchParams.get("previewAs");
    if (!requestedId) return;

    let cancelled = false;
    (async () => {
      try {
        // The server will validate role + org membership via the X-Preview-As
        // header below; we just need the client's name/email for the banner.
        const res = await fetch(`${API_URL}/api/clients?page=1&limit=200`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load clients");
        const body = (await res.json()) as PaginatedResponse<MemberRecord>;
        const match = body.data.find((m) => m.userId === requestedId);
        if (!match) throw new Error("Client not found");
        if (cancelled) return;
        const state: PreviewModeState = {
          clientId: match.userId,
          clientName: match.user.name,
          clientEmail: match.user.email,
        };
        writeStored(state);
        setPreview(state);
      } catch (err) {
        console.error("preview-mode init failed", err);
        writeStored(null);
        setPreview(null);
      } finally {
        if (!cancelled) {
          // Strip ?previewAs= from the URL.
          router.replace("/portal");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const exitPreview = useCallback(() => {
    writeStored(null);
    setPreview(null);
    if (typeof window !== "undefined") {
      // Try to close the tab (works when opened via window.open).
      window.close();
      // Fallback if the browser blocks close().
      setTimeout(() => {
        if (!window.closed) router.push("/dashboard/clients");
      }, 100);
    }
  }, [router]);

  const value = useMemo(
    () => ({ preview, exitPreview }),
    [preview, exitPreview],
  );

  return (
    <PreviewModeContext.Provider value={value}>
      {children}
    </PreviewModeContext.Provider>
  );
}

export function usePreviewMode(): PreviewModeContextValue {
  return useContext(PreviewModeContext);
}

export function getStoredPreviewClientId(): string | null {
  return readStored()?.clientId ?? null;
}
