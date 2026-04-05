import { useEffect, useState } from "react";

export interface AppConfig {
  billingEnabled: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Module-level cache — fetched once per page load, shared across all consumers
let cache: AppConfig | null = null;
let pending: Promise<AppConfig> | null = null;

function fetchConfig(): Promise<AppConfig> {
  if (!pending) {
    pending = fetch(`${API_URL}/api/health/config`)
      .then((r) => r.json())
      .then((data: AppConfig) => {
        cache = data;
        return data;
      })
      .catch(() => {
        pending = null; // allow retry on next mount
        return { billingEnabled: false };
      });
  }
  return pending;
}

export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(cache);

  useEffect(() => {
    if (cache) return;
    fetchConfig().then(setConfig);
  }, []);

  return config;
}
