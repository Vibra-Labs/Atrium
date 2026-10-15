import { redirect } from "next/navigation";

// API keys and MCP moved into the Integrations tab; keep old links working.
export default function ApiKeysPage(): never {
  redirect("/dashboard/settings/integrations");
}
