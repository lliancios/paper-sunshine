import type { NextConfig } from "next";

// Identifies this deploy so open pages can tell when a newer one is live.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // pdf.js ships an optional node-canvas dependency we never use in the browser.
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
