/**
 * These pages are all client components with no server layout of their own, so
 * Next would statically prerender them at build time. That resolved
 * NEXT_PUBLIC_TRACKERS during `next build` -- where it is absent, because the
 * published image must not carry anyone's analytics -- and baked in an empty
 * tracker list that no runtime configuration could override. /signup and
 * /accept-invite therefore never reported.
 *
 * Rendering them per request lets the root layout read the operator's runtime
 * environment, the same way /login and /dashboard always have. These are
 * low-traffic auth pages that already fetch their config client-side, so
 * nothing is lost by not prerendering them.
 */
export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
