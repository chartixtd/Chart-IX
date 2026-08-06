import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 见 sentry.server.config.ts 同项注释
  tracesSampleRate: 0.2,
  enabled: process.env.NODE_ENV === "production",
});
