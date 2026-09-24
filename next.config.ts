import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@xyflow/react"],
  },
};

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig);
