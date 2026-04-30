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

    const clientName = searchParams.get("previewName") || "Client";
    const clientEmail = searchParams.get("previewEmail") || "";
    const state: PreviewModeState = {
      clientId: requestedId,
      clientName,
      clientEmail,
    };
    writeStored(state);
    setPreview(state);

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/portal");
    }
  }, [searchParams]);

  const exitPreview = useCallback(() => {
    writeStored(null);
    setPreview(null);
    if (typeof window === "undefined") return;
    // Opened via window.open from dashboard; close if allowed, else navigate back.
    window.close();
    setTimeout(() => {
      if (!window.closed) router.push("/dashboard/clients");
    }, 100);
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
