import type { NextConfig } from "next";

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const internalApiUrl = process.env.INTERNAL_API_URL || publicApiUrl;

const nextConfig: NextConfig = {
  // 启用 React 严格模式
  reactStrictMode: true,

  // 环境变量
  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
  },

  // 重写 API 请求到后端
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
