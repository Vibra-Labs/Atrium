import type { NextConfig } from "next";

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
