import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime instead of being bundled (heavy Google auth/gRPC deps; only used by the push sender).
  serverExternalPackages: ["firebase-admin"],
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@xyflow/react"],
    // Raised from Next's ~1MB default so a bug-report screenshot attachment (createBugReportAction,
    // capped at 8MB server-side) can actually reach the action.
    serverActions: { bodySizeLimit: "8mb" },
  },
  async headers() {
    return [
      {
        // The Android app (built by .github/workflows/android-apk.yml) is committed here and linked from Help.
        // Correct type + attachment so phones offer to install it; always revalidate so a rebuilt APK isn't served stale.
        source: "/downloads/:file*.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="Supportify.apk"' },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig);
