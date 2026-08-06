import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 100% 采样在有真实流量后开销和配额消耗都太大；0.1 仍然能给出有代表性的
  // 性能画像。报错捕获（非 tracing）不受这个采样率影响，始终 100% 上报。
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
  // 会话回放先关闭，之后需要再打开（涉及录屏隐私，交易页面尤其要谨慎）
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
