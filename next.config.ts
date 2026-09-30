import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@xyflow/react"],
    // Raised from Next's ~1MB default so a bug-report screenshot attachment (createBugReportAction,
    // capped at 8MB server-side) can actually reach the action.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig);
