import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// SW 的版本号：注册时作为 query 传入，URL 变化即被浏览器认定为新 worker。
// 这样每次部署自动换代，不依赖人记得手改版本号常量。
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  experimental: {
    optimizePackageImports: ["next-intl", "@tanstack/react-query", "react-resizable-panels", "zustand"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "www.gravatar.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // ffmpeg.wasm 的多线程核心（快 3–5 倍）需要 SharedArrayBuffer，而
        // SharedArrayBuffer 只在跨源隔离的文档里可用，跨源隔离又需要下面这两
        // 个头。视频压缩只发生在后台，所以只给 /admin 加：公开页面不受影响，
        // 也就不会因为 COEP 拦掉第三方图片或嵌入内容——这正是 2026-08-02 那版
        // 设计当初放弃多线程核心的顾虑。
        //
        // credentialless 而不是 require-corp：后台要加载 Supabase 存储的封面图，
        // require-corp 要求对端回 CORP 头、会整批拦掉；credentialless 以无凭据
        // 方式放行 no-cors 子资源，而 Supabase 的公开 URL 与签名 URL（鉴权在
        // query 里）都不依赖 cookie，行为不变。
        //
        // Safari 不支持 credentialless——那里 crossOriginIsolated 为 false，
        // src/lib/video-compress.ts 的 resolveFFmpegCoreConfig 自动回落单线程
        // 核心，功能不坏，只是慢。
        //
        // 两条规则：path-to-regexp 里 "/admin/:path*" 对 "/admin" 本身是否匹配
        // 依赖版本细节，与其赌不如显式各写一条。
        source: "/admin",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        // SW 脚本必须每次revalidate，否则新版本要等浏览器的 24h 上限才生效
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/sw-strategy.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  // 还没配置 Sentry org/project/authToken，暂时不上传 sourcemap
  // （不影响错误上报，只是堆栈里看到的是压缩后的代码；以后配置好了再打开）
  sourcemaps: { disable: true },
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
});
