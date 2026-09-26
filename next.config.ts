import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdf.js ships an optional node-canvas dependency we never use in the browser.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
