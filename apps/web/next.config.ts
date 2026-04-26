import type { NextConfig } from "next";
import { copyFileSync, existsSync } from "fs";
import { join } from "path";
import { withSentryConfig } from "@sentry/nextjs";

// Copy CHANGELOG.md into the web app directory at config load time so webpack can resolve it
const changelogSrc = join(__dirname, "../../CHANGELOG.md");
const changelogDest = join(__dirname, "CHANGELOG.md");
if (existsSync(changelogSrc) && !existsSync(changelogDest)) {
  try { copyFileSync(changelogSrc, changelogDest); } catch { /* ignore */ }
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@atrium/shared"],
  images: {
    unoptimized: true, // CVE-2026-27980: disable image optimization (not used in this app)
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-src " +
              // Regex-based providers (fast path)
              "https://www.youtube.com https://www.loom.com https://www.figma.com https://docs.google.com " +
              // oEmbed providers (resolved via /api/embeds/resolve)
              "https://www.canva.com https://canva.com " +
              "https://open.spotify.com " +
              "https://w.soundcloud.com https://soundcloud.com " +
              "https://codepen.io " +
              "https://player.vimeo.com;",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /CHANGELOG\.md$/,
      type: "asset/source",
    });
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI output during builds unless a DSN/auth token is set
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Upload source maps only when an auth token is provided (CI/CD or production builds)
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Disable the Sentry telemetry for the SDK itself
  telemetry: false,
});
