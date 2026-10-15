"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { DestinationsSection } from "./destinations-section";
import { ApiKeysSection } from "./api-keys-section";
import { ConnectCard } from "./connect-card";
import { ConnectedAppsSection } from "./connected-apps-section";

export default function IntegrationsPage(): React.ReactElement {
  const [oauthEnabled, setOauthEnabled] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<{ mcpOAuthEnabled?: boolean }>("/health/config")
      .then((cfg) => setOauthEnabled(Boolean(cfg.mcpOAuthEnabled)))
      .catch((err: unknown) => console.error(err));
  }, []);

  return (
    <div className="max-w-2xl divide-y divide-[var(--border)]">
      <div className="pb-8">
        <DestinationsSection />
      </div>
      <div className="pt-8 divide-y divide-[var(--border)]">
        <ConnectCard oauthEnabled={oauthEnabled} />
        {oauthEnabled && <ConnectedAppsSection />}
        <ApiKeysSection />
      </div>
    </div>
  );
}
