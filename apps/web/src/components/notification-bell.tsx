"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Shared notification state — ensures a single polling interval even when
// multiple <NotificationBell /> instances are mounted (desktop + mobile).
// ---------------------------------------------------------------------------

interface NotificationState {
  unreadCount: number;
  setUnreadCount: (v: number | ((prev: number) => number)) => void;
}

const NotificationContext = createContext<NotificationState | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchCount = () => {
      apiFetch<{ count: number }>("/notifications/unread-count")
        .then((res) => setUnreadCount(res.count))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <NotificationContext.Provider value={{ unreadCount, setUnreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface PaginatedResponse {
  data: Notification[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// NotificationBell component
// ---------------------------------------------------------------------------

export function NotificationBell({ align = "right" }: { align?: "left" | "right" } = {}) {
  const ctx = useContext(NotificationContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fallback local state if used outside provider (shouldn't happen, but safe)
  const [localCount, setLocalCount] = useState(0);
  const unreadCount = ctx?.unreadCount ?? localCount;
  const setUnreadCount = ctx?.setUnreadCount ?? setLocalCount;

  // Check push subscription status
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushSubscribed(!!sub))
      .catch(() => {});
  }, []);

  const fetchNotifications = useCallback(() => {
    setLoading(true);
    apiFetch<PaginatedResponse>("/notifications?limit=10")
      .then((res) => setNotifications(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  const handleClick = (n: Notification) => {
    if (!n.read) {
      apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" }).catch(
        () => {},
      );
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      );
      setUnreadCount((c: number) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const handleMarkAllRead = () => {
    apiFetch("/notifications/read-all", { method: "PATCH" }).catch(() => {});
    setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnreadCount(0);
  };

  const handleEnablePush = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

      const { publicKey } = await apiFetch<{ publicKey: string }>(
        "/push/vapid-key",
      );
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });
      const sub = subscription.toJSON();
      await apiFetch("/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.keys,
        }),
      });
      setPushSubscribed(true);
    } catch {
      // User denied or something went wrong
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className="relative p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-full mt-2 w-80 max-h-96 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-50 flex flex-col overflow-hidden ${align === "left" ? "left-0" : "right-0"}`}
          role="menu"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-[var(--primary)] hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--muted-foreground)]">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-[var(--muted)] transition-colors border-b border-[var(--border)] last:border-b-0 ${
                    !n.read ? "bg-[var(--muted)]/50" : ""
                  }`}
                  role="menuitem"
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" />
                    )}
                    <div className={`flex-1 min-w-0 ${n.read ? "ml-4" : ""}`}>
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      <p className="text-xs text-[var(--muted-foreground)] truncate">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        {timeAgo(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer — push opt-in */}
          {typeof window !== "undefined" &&
            "PushManager" in window &&
            !pushSubscribed && (
              <div className="border-t border-[var(--border)] px-3 py-2">
                <button
                  onClick={handleEnablePush}
                  className="text-xs text-[var(--primary)] hover:underline w-full text-center"
                >
                  Enable push notifications
                </button>
              </div>
            )}
          {pushSubscribed && (
            <div className="border-t border-[var(--border)] px-3 py-2 text-center">
              <span className="text-[10px] text-[var(--muted-foreground)]">
                Push notifications enabled
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
