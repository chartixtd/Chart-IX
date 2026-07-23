import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh-CN", "en-US", "ms-MY"],
  defaultLocale: "en-US",
  localePrefix: "always",
  localeDetection: true,
});
