import { resolveInternalApiUrl } from "./lib/internal-api-url";

/**
 * Runs once when the server starts. Exits on a missing INTERNAL_API_URL, as
 * the API does on a missing DATABASE_URL: Next would otherwise keep running
 * and answer every page with a 500.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` may load this too, and builds don't set the variable.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    resolveInternalApiUrl(process.env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
