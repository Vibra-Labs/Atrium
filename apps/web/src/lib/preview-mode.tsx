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
import { previewReturnPath } from "./legacy-routes";

const STORAGE_KEY = "atrium:previewAs";
const HANDOFF_PREFIX = "atrium:previewPending:";
const HANDOFF_TTL_MS = 60_000;

export interface PreviewModeState {
  clientId: string;
  clientName: string;
  clientEmail: string;
  /** Dashboard page to go back to when the preview tab can't close itself. */
  returnPath?: string;
}

interface PreviewHandoff {
  name: string;
  email: string;
  returnPath?: string;
  ts: number;
}

const DEFAULT_RETURN_PATH = "/dashboard/contacts";

export function startPreview(
  clientUserId: string,
  clientName: string,
  clientEmail: string,
  returnPath?: string,
  targetUrl: string = "/portal",
): void {
  if (typeof window === "undefined") return;
  try {
    const handoff: PreviewHandoff = {
      name: clientName,
      email: clientEmail,
      returnPath,
      ts: Date.now(),
    };
    window.localStorage.setItem(
      HANDOFF_PREFIX + clientUserId,
      JSON.stringify(handoff),
    );
  } catch (err) {
    console.error("preview-mode handoff write failed", err);
  }
  const url = new URL(targetUrl, window.location.origin);
  url.searchParams.set("previewAs", clientUserId);
  window.open(url.toString(), "_blank", "noopener");
}

function readHandoff(clientUserId: string): PreviewHandoff | null {
  if (typeof window === "undefined") return null;
  const key = HANDOFF_PREFIX + clientUserId;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    window.localStorage.removeItem(key);
    const parsed = JSON.parse(raw) as PreviewHandoff;
    if (Date.now() - parsed.ts > HANDOFF_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
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

    const handoff = readHandoff(requestedId);
    const state: PreviewModeState = {
      clientId: requestedId,
      clientName: handoff?.name || "Client",
      clientEmail: handoff?.email || "",
      returnPath: previewReturnPath(handoff?.returnPath),
    };
    writeStored(state);
    setPreview(state);

    if (typeof window !== "undefined") {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("previewAs");
      window.history.replaceState(null, "", cleanUrl.pathname + cleanUrl.search);
    }
  }, [searchParams]);

  const exitPreview = useCallback(() => {
    const returnPath: string = preview?.returnPath ?? DEFAULT_RETURN_PATH;
    writeStored(null);
    setPreview(null);
    if (typeof window === "undefined") return;
    // Opened via window.open from dashboard; close if allowed, else navigate back.
    window.close();
    setTimeout(() => {
      if (!window.closed) router.push(returnPath);
    }, 100);
  }, [router, preview]);

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
