"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
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
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ConfirmProvider>
        <ToastProvider>
          <NotificationProvider>{children}</NotificationProvider>
        </ToastProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
