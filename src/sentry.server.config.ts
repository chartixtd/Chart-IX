import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 交易/下单相关的错误优先级高，比 client 端保留更高的采样率；
  // 但 1.0 在真实流量下配额/开销都撑不住，先降到 0.2。
  // 错误捕获（非 tracing）不受这个采样率影响，始终 100% 上报。
  tracesSampleRate: 0.2,
  enabled: process.env.NODE_ENV === "production",
});
