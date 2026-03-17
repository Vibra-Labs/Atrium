import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@atrium/shared"],
  outputFileTracingIncludes: {
    "/changelog": ["../../CHANGELOG.md"],
    "/dashboard/changelog": ["../../CHANGELOG.md"],
    "/portal/changelog": ["../../CHANGELOG.md"],
  },
};

export default nextConfig;
