import { useEffect, useState } from "react";
import { DEFAULT_CURRENCY } from "@atrium/shared";

export interface AppConfig {
  billingEnabled: boolean;
  signupEnabled: boolean;
  currency: string;
  /** Operator's terms of service and privacy policy, shown on signup when set. */
  termsUrl?: string | null;
  privacyUrl?: string | null;
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
        return { billingEnabled: false, signupEnabled: true, currency: DEFAULT_CURRENCY };
      });
  }
  return pending;
}

export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(cache);

  useEffect(() => {
    // Another component may have filled the cache between this render and now.
    if (cache) {
      setConfig(cache);
      return;
    }
    fetchConfig().then(setConfig);
  }, []);

  return config;
}

/** The instance currency (ISO 4217, lowercase); USD until the config loads. */
export function useCurrency(): string {
  return useAppConfig()?.currency ?? DEFAULT_CURRENCY;
}
