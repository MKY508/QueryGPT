import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const internalApiUrl = process.env.INTERNAL_API_URL || publicApiUrl;
// `next build` removes and rewrites its dist directory. Keep development
// chunks elsewhere so a desktop/release build cannot corrupt a running dev
// server. Desktop packaging supplies its own third directory explicitly.
const nextDistDir =
  process.env.RECEIPTBI_NEXT_DIST_DIR ||
  (process.env.NODE_ENV === "development" ? ".next-dev" : ".next");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  output: 'standalone',
  distDir: nextDistDir,

  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiUrl}/api/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
