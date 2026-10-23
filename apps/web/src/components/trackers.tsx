import { connection } from "next/server";
import { maskAnalyticsEvent } from "@/lib/mask-analytics";
import { getTrackers, MASK_FN, type Tracker } from "@/lib/trackers";

// Analytics must never carry identifiers. The hook is serialised into the page
// so it runs for every event, including Umami's auto-tracked pageviews.
const MASK_SCRIPT: string = `window.${MASK_FN}=${maskAnalyticsEvent.toString()};`;

/**
 * Renders the operator's tracker <script> tags into the served HTML.
 *
 * connection() opts every route into per-request rendering, so the tags come
 * from the running server's environment. Without it Next prerenders static
 * pages (/, /changelog) at build time with whatever env the build had.
 */
export async function Trackers(): Promise<React.ReactElement | null> {
  await connection();
  const trackers: Tracker[] = getTrackers(process.env);
  if (trackers.length === 0) return null;

  return (
    <>
      {/* Must be defined before the tracker loads: it is read per event. */}
      <script dangerouslySetInnerHTML={{ __html: MASK_SCRIPT }} />
      {/* Plain tags, not next/script: afterInteractive injects after hydration,
          so the served HTML would never contain them. */}
      {trackers.map((tracker: Tracker) => (
        <script key={tracker.src} defer {...tracker} />
      ))}
    </>
  );
}
