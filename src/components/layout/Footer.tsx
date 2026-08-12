import Image from "next/image";
import { useTranslations } from "next-intl";
import type { SiteSettings } from "@/lib/site-settings";

/**
 * 纯展示组件：设置由服务端布局取好后传进来。
 *
 * 原先这里自己在 useEffect 里查一次 admin_settings 拿 telegram_group，
 * 结果是每个页面多一次客户端往返 + 链接迟一拍才出现。现在整份设置在
 * LocaleLayout 里读（getSiteSettings 带请求级缓存），一次都不多查。
 */

const SOCIAL_ICONS = {
  twitter: (
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  ),
  discord: (
    <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.099.246.197.372.291a.077.077 0 01-.006.128 12.3 12.3 0 01-1.873.891.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  ),
  youtube: (
    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.121 2.136c1.871.505 9.377.505 9.377.505s7.505 0 9.376-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  ),
} as const;

type SocialKey = keyof typeof SOCIAL_ICONS;

export function Footer({ settings }: { settings: SiteSettings }) {
  const t = useTranslations("footer");

  const socials = (Object.keys(SOCIAL_ICONS) as SocialKey[])
    .map((key) => ({ key, url: settings.socialLinks[key] }))
    .filter((s): s is { key: SocialKey; url: string } => Boolean(s.url));

  return (
    // 页脚是每一页的收束点：暖黑曜石底 + 顶边一条金色发丝，
    // 与顶栏 shadow-nav 的那条金线上下呼应
    <footer className="grain relative border-t border-border-default bg-bg-secondary/40">
      <div className="hairline-gold absolute inset-x-0 top-0 opacity-40" />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt={settings.siteName ?? "Chart-IX"}
              width={240}
              height={160}
              className="h-8 w-auto opacity-90"
            />
            <span className="font-display text-lg font-semibold leading-none tracking-tight text-text-primary">
              {settings.siteName ? (
                settings.siteName
              ) : (
                <>
                  Chart<span className="text-gold">-IX</span>
                </>
              )}
            </span>
          </div>

          <div className="hairline-gold w-24" />

          <p className="max-w-md text-sm leading-relaxed text-text-secondary">
            {settings.siteDescription ?? t("description")}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {settings.telegramGroup && (
              <a
                href={settings.telegramGroup}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-gold/25 px-4 py-2 text-xs font-medium text-gold transition-all duration-200 hover:border-gold/60 hover:bg-gold/5"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.036 15.803l-.396 5.57c.567 0 .812-.244 1.108-.537l2.66-2.545 5.513 4.03c1.01.556 1.73.264 1.99-.933L23.94 3.94c.36-1.464-.53-2.037-1.51-1.68L1.11 10.44c-1.44.556-1.42 1.35-.245 1.708l5.462 1.704L18.9 6.297c.545-.36 1.04-.16.633.2z" />
                </svg>
                {t("join_telegram")}
              </a>
            )}

            {socials.map(({ key, url }) => (
              <a
                key={key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={key}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-default text-text-secondary transition-all duration-200 hover:border-gold/60 hover:text-gold"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  {SOCIAL_ICONS[key]}
                </svg>
              </a>
            ))}
          </div>

          {settings.contactEmail && (
            <a
              href={`mailto:${settings.contactEmail}`}
              className="text-xs text-text-secondary transition-colors hover:text-gold"
            >
              {settings.contactEmail}
            </a>
          )}

          <p className="text-xs tracking-wide text-text-muted">
            {settings.footerText ?? t("copyright")}
          </p>
        </div>
      </div>
    </footer>
  );
}
