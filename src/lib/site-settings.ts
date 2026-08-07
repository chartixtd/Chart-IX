import { cache } from "react";
import { createServiceRoleClient } from "@/lib/supabase/middleware";

/**
 * 站点设置的服务端读取。
 *
 * 背景：admin_settings 里 6 个 key 原先只有 telegram_group 真被读过，另外 5 个
 * （site_name / site_description / contact_email / footer_text / social_links）
 * 写进库后没有任何代码消费。footer_text 尤其误导——后台看着就是「编辑页脚文字」
 * 的入口，而页脚实际渲染的是 i18n 字典里写死的 copyright。这个模块把这 5 个
 * 接上真实渲染，让后台改动能立刻反映到页面。
 *
 * 值的形态兼容两种：
 *   - 纯字符串        "Chart-IX"
 *   - 按语言的对象    {"en-US": "...", "zh-CN": "..."}
 * 后者才是设置编辑器占位符 `{"en-US":"My Site"}` 暗示的设计。一个只填了中文的
 * 值不会因此覆盖掉英文页面的 SEO 文案——取不到当前语言时回退到 i18n 默认值。
 */

export interface SocialLinks {
  twitter?: string;
  discord?: string;
  youtube?: string;
}

export interface SiteSettings {
  siteName: string | null;
  /** 已按当前语言解析 */
  siteDescription: string | null;
  contactEmail: string | null;
  /** 已按当前语言解析 */
  footerText: string | null;
  telegramGroup: string | null;
  socialLinks: SocialLinks;
}

const KEYS = [
  "site_name",
  "site_description",
  "contact_email",
  "footer_text",
  "telegram_group",
  "social_links",
] as const;

/**
 * 从一个可能是字符串、也可能是 {locale: text} 的值里取出当前语言的文案。
 * 取不到返回 null，由调用方决定回退到什么。
 */
function pickLocalized(value: unknown, locale: string): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const map = value as Record<string, unknown>;
    // 精确匹配优先；再退到同语种的其他地区变体（zh-CN 值也能服务 zh-TW 页面）
    const exact = map[locale];
    if (typeof exact === "string" && exact.trim()) return exact.trim();
    const base = locale.split("-")[0];
    for (const [k, v] of Object.entries(map)) {
      if (k.split("-")[0] === base && typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickSocialLinks(value: unknown): SocialLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map = value as Record<string, unknown>;
  const out: SocialLinks = {};
  for (const k of ["twitter", "discord", "youtube"] as const) {
    const url = pickString(map[k]);
    // 只接受 http(s)，防止后台误填 javascript: 之类的值直接进 href
    if (url && /^https?:\/\//i.test(url)) out[k] = url;
  }
  return out;
}

/**
 * React 的请求级缓存：同一次渲染里 generateMetadata 和布局各调一次，
 * 只会真正查一次库。
 */
export const getSiteSettings = cache(async (locale: string): Promise<SiteSettings> => {
  const empty: SiteSettings = {
    siteName: null,
    siteDescription: null,
    contactEmail: null,
    footerText: null,
    telegramGroup: null,
    socialLinks: {},
  };

  try {
    const { data, error } = await createServiceRoleClient()
      .from("admin_settings")
      .select("key, value")
      .in("key", KEYS as unknown as string[]);

    if (error || !data) return empty;

    const byKey = new Map(data.map((r) => [r.key as string, r.value as unknown]));
    return {
      siteName: pickLocalized(byKey.get("site_name"), locale),
      siteDescription: pickLocalized(byKey.get("site_description"), locale),
      contactEmail: pickString(byKey.get("contact_email")),
      footerText: pickLocalized(byKey.get("footer_text"), locale),
      telegramGroup: pickString(byKey.get("telegram_group")),
      socialLinks: pickSocialLinks(byKey.get("social_links")),
    };
  } catch {
    // 站点设置是装饰性配置，读不到就用 i18n 默认值渲染，绝不能让整页 500。
    return empty;
  }
});
