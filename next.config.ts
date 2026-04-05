import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 has native bindings that should not be bundled
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
