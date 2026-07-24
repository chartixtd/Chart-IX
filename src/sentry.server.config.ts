import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 交易/下单相关的错误优先级高，先用较高采样率；量上来后可以调低
  tracesSampleRate: 1.0,
  enabled: process.env.NODE_ENV === "production",
});
