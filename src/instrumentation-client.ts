import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enabled: process.env.NODE_ENV === "production",
  // 会话回放先关闭，之后需要再打开（涉及录屏隐私，交易页面尤其要谨慎）
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
