import type { NextConfig } from "next";
import { copyFileSync, existsSync } from "fs";
import { join } from "path";
import { withSentryConfig } from "@sentry/nextjs";
import { resolveInternalApiUrl } from "./src/lib/internal-api-url";
import { shouldBundleSentry } from "./src/lib/sentry-config";

// Copy CHANGELOG.md into the web app directory at config load time so webpack can resolve it
const changelogSrc = join(__dirname, "../../CHANGELOG.md");
const changelogDest = join(__dirname, "CHANGELOG.md");
if (existsSync(changelogSrc)) {
  try { copyFileSync(changelogSrc, changelogDest); } catch { /* ignore */ }
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@atrium/shared"],
  images: {
    unoptimized: true, // CVE-2026-27980: disable image optimization (not used in this app)
  },
  // Fixed redirects run before any rendering, so the layouts' server fetches
  // aren't paid for a page that only redirects.
  async redirects() {
    return [
      { source: "/portal", destination: "/portal/projects", permanent: false },
      { source: "/dashboard/settings", destination: "/dashboard/settings/account", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-src 'self' blob: " +
              // Regex-based providers (fast path)
              "https://www.youtube.com https://www.loom.com https://www.figma.com https://docs.google.com " +
              // oEmbed providers (resolved via /api/embeds/resolve)
              "https://www.canva.com https://canva.com " +
              "https://open.spotify.com " +
              "https://w.soundcloud.com https://soundcloud.com " +
              "https://codepen.io " +
              "https://player.vimeo.com; " +
              // The OAuth consent screen must not be frameable: clickjacking it
              // would let a page harvest an Allow click. Today only SameSite
              // stands in the way.
              "frame-ancestors 'self';",
          },
        ],
      },
    ];
  },
  // Dev only: serve /api from the app's origin, as the Docker image does, so a
  // fresh clone works without NEXT_PUBLIC_API_URL. Production rewrites would
  // be fixed at build time and bypass the Origin rewrite Caddy relies on.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const apiUrl: string = resolveInternalApiUrl(process.env);
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /CHANGELOG\.md$/,
      type: "asset/source",
    });
    return config;
  },
};

// Without a build-time DSN the Sentry SDK is neither wrapped nor bundled.
export default shouldBundleSentry(process.env)
  ? withSentryConfig(nextConfig, {
      // Suppress Sentry CLI output during builds unless an auth token is set
      silent: !process.env.SENTRY_AUTH_TOKEN,
      // Upload source maps only when an auth token is provided (CI/CD or production builds)
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
      // Drop debug logging and unused replay code from the bundle
      bundleSizeOptimizations: {
        excludeDebugStatements: true,
        excludeReplayShadowDom: true,
        excludeReplayIframe: true,
        excludeReplayWorker: true,
      },
      // Disable the Sentry telemetry for the SDK itself
      telemetry: false,
    })
  : nextConfig;
