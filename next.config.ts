import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@thething/core"],
};

export default nextConfig;