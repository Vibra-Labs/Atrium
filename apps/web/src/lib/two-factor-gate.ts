import "server-only";
import { unstable_rethrow } from "next/navigation";
import { serverFetch } from "./server-api";
import { pageForStatus } from "./two-factor-redirect";
import type { GatePage, GateStatus } from "./two-factor-redirect";

/**
 * For server layouts: the page a signed-in user must visit first (the code
 * screen or 2FA setup), or null. Every other API call from such a session is
 * refused, so layouts check this before rendering.
 */
export async function twoFactorGatePage(): Promise<GatePage | null> {
  try {
    const res: Response = await serverFetch("/api/two-factor/status");
    if (!res.ok) return null;
    return pageForStatus((await res.json()) as GateStatus);
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load two-factor status", err);
    return null;
  }
}
