import { ApiKeysSection } from "./api-keys-section";
import { ConnectCard } from "./connect-card";

export default function ApiKeysPage(): React.ReactElement {
  return (
    <div className="max-w-lg divide-y divide-[var(--border)]">
      <ApiKeysSection />
      <ConnectCard />
    </div>
  );
}
