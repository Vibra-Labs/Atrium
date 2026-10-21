import { clearCached } from "@/lib/cached";
import { resetPlanState } from "@/lib/plan-features";

/** Forget everything cached for the active workspace; call after a soft workspace switch. */
export function resetWorkspaceCaches(): void {
  resetPlanState();
  clearCached();
}
