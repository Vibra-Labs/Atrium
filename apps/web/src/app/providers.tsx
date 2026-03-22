"use client";

import { useEffect } from "react";
import { ConfirmProvider } from "@/components/confirm-modal";
import { ToastProvider } from "@/components/toast";
import { NotificationProvider } from "@/components/notification-bell";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <ConfirmProvider>
      <ToastProvider>
        <NotificationProvider>{children}</NotificationProvider>
      </ToastProvider>
    </ConfirmProvider>
  );
}
