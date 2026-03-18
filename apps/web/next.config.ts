import type { NextConfig } from "next";
import { copyFileSync, existsSync } from "fs";
import { join } from "path";

// Copy CHANGELOG.md into the web app directory at config load time so webpack can resolve it
const changelogSrc = join(__dirname, "../../CHANGELOG.md");
const changelogDest = join(__dirname, "CHANGELOG.md");
if (existsSync(changelogSrc) && !existsSync(changelogDest)) {
  try { copyFileSync(changelogSrc, changelogDest); } catch { /* ignore */ }
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@atrium/shared"],
  webpack: (config) => {
    config.module.rules.push({
      test: /CHANGELOG\.md$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
