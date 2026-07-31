export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Chart-IX";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://chart-ix.com";

export const BINGX_API_BASE = process.env.BINGX_API_BASE_URL || "https://open-api.bingx.com";

export const LOCALES = ["zh-CN", "en-US", "ms-MY"] as const;

/**
 * 前台可见的语言列表。ms-MY 路由仍可访问，但不在语言切换入口中展示。
 * 后台内容管理仍使用 LOCALES（可为 ms-MY 标记内容）。
 */
export const PUBLIC_LOCALES = ["zh-CN", "en-US"] as const;

export const LANGUAGE_LABELS: Record<string, string> = {
  "zh-CN": "中文",
  "en-US": "English",
  "ms-MY": "Bahasa Melayu",
};

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 12,
  MAX_PAGE_SIZE: 100,
  ADMIN_PAGE_SIZE: 20,
} as const;

export const VIDEO = {
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024, // 2GB
  ALLOWED_TYPES: ["video/mp4", "video/quicktime", "video/x-matroska"],
  THUMBNAIL_MAX_SIZE: 5 * 1024 * 1024, // 5MB
  THUMBNAIL_TYPES: ["image/png", "image/jpeg", "image/webp"],
  FREE_PREVIEW_SECONDS: 60,
  PROGRESS_SYNC_INTERVAL: 10000, // 10秒
} as const;

export const RATE_LIMITS = {
  MARKET: { windowMs: 1000, max: 30 },
  SPOT_TRADE: { windowMs: 1000, max: 10 },
  FUTURES_TRADE: { windowMs: 1000, max: 5 },
  LOGIN: { windowMs: 1000, max: 5 },
  ADMIN: { windowMs: 1000, max: 20 },
} as const;
