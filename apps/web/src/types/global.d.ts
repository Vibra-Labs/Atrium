interface Window {
  umami?: {
    track: (event: string, data?: Record<string, string | number | boolean>) => void;
  };
  /** Google Tag Manager's event queue. See lib/track.ts. */
  dataLayer?: Record<string, unknown>[];
  /** Set by GTM when a container executes; absent means no container loaded. */
  google_tag_manager?: Record<string, unknown>;
}
