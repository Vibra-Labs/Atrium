"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ApiKeysSection } from "./api-keys-section";
import { ConnectCard } from "./connect-card";
import { ConnectedAppsSection } from "./connected-apps-section";

export default function ApiKeysPage(): React.ReactElement {
  const [oauthEnabled, setOauthEnabled] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<{ mcpOAuthEnabled?: boolean }>("/health/config")
      .then((cfg) => setOauthEnabled(Boolean(cfg.mcpOAuthEnabled)))
      .catch((err: unknown) => console.error(err));
  }, []);

  return (
    <div className="max-w-lg divide-y divide-[var(--border)]">
      <ConnectCard oauthEnabled={oauthEnabled} />
      {oauthEnabled && <ConnectedAppsSection />}
      <ApiKeysSection />
    </div>
  );
}
