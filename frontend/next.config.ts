import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  turbopack: { root: path.resolve(__dirname, "..") },
  // Type-check only application code during the build; `tsc --noEmit` covers the tests.
  typescript: { tsconfigPath: "tsconfig.build.json" },
};

export default nextConfig;
