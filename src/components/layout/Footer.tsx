import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { SiteSettings } from "@/lib/site-settings";

/**
 * 页脚：编辑式四栏。品牌一栏占半幅，导航与社群两栏，联系与法务一栏。
 * 底部压一行超大的淡金水印字「CHART-IX」——它是页面的收束，不是内容。
 * 纯展示组件：设置由服务端布局取好后传进来。
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

const TELEGRAM_PATH =
  "M9.036 15.803l-.396 5.57c.567 0 .812-.244 1.108-.537l2.66-2.545 5.513 4.03c1.01.556 1.73.264 1.99-.933L23.94 3.94c.36-1.464-.53-2.037-1.51-1.68L1.11 10.44c-1.44.556-1.42 1.35-.245 1.708l5.462 1.704L18.9 6.297c.545-.36 1.04-.16.633.2z";

const FOOTER_LINK =
  "text-sm text-text-secondary transition-colors hover:text-text-primary";

export function Footer({ settings }: { settings: SiteSettings }) {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav");
  const locale = useLocale();

  const socials = (Object.keys(SOCIAL_ICONS) as SocialKey[])
    .map((key) => ({ key, url: settings.socialLinks[key] }))
    .filter((s): s is { key: SocialKey; url: string } => Boolean(s.url));

  const exploreLinks = [
    { key: "videos", href: `/${locale}/videos` },
    { key: "articles", href: `/${locale}/articles` },
    { key: "news", href: `/${locale}/news` },
    { key: "screener", href: `/${locale}/screener` },
    { key: "tools", href: `/${locale}/tools/position-size` },
  ] as const;

  return (
    <footer className="relative overflow-hidden border-t border-border-default bg-bg-primary">
      <div className="hairline-gold absolute inset-x-0 top-0 opacity-50" />

      <div className="mx-auto max-w-page px-6 pb-12 pt-20">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          {/* 品牌 */}
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt={settings.siteName ?? "Chart-IX"}
                width={240}
                height={160}
                className="h-9 w-auto"
              />
              <span className="font-display text-lg font-medium tracking-tight text-text-primary">
                {settings.siteName ? (
                  settings.siteName
                ) : (
                  <>
                    Chart<span className="text-gold">-IX</span>
                  </>
                )}
              </span>
            </div>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-text-secondary">
              {settings.siteDescription ?? t("description")}
            </p>
            {socials.length > 0 && (
              <div className="mt-8 flex items-center gap-2">
                {socials.map(({ key, url }) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={key}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-border-hover text-text-secondary transition-colors duration-300 hover:border-gold/60 hover:text-gold"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      {SOCIAL_ICONS[key]}
                    </svg>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* 探索 */}
          <div className="lg:col-span-3">
            <p className="eyebrow">{tNav("tab_learn")}</p>
            <ul className="mt-6 space-y-3.5">
              {exploreLinks.map((l) => (
                <li key={l.key}>
                  <Link href={l.href} className={FOOTER_LINK}>
                    {tNav(l.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 社群 */}
          <div className="lg:col-span-2">
            <p className="eyebrow">{tNav("account")}</p>
            <ul className="mt-6 space-y-3.5">
              <li>
                <Link href={`/${locale}/login`} className={FOOTER_LINK}>
                  {tNav("sign_in")}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/register`} className={FOOTER_LINK}>
                  {tNav("sign_up")}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/upgrade`} className={FOOTER_LINK}>
                  {tNav("upgrade")}
                </Link>
              </li>
            </ul>
          </div>

          {/* 联系 */}
          <div className="lg:col-span-2">
            <p className="eyebrow">{t("contact")}</p>
            <ul className="mt-6 space-y-3.5">
              {settings.telegramGroup && (
                <li>
                  <a
                    href={settings.telegramGroup}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${FOOTER_LINK} inline-flex items-center gap-2`}
                  >
                    <svg className="h-3.5 w-3.5 text-gold" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d={TELEGRAM_PATH} />
                    </svg>
                    Telegram
                  </a>
                </li>
              )}
              {settings.contactEmail && (
                <li>
                  <a href={`mailto:${settings.contactEmail}`} className={`${FOOTER_LINK} break-all`}>
                    {settings.contactEmail}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-20 flex flex-col gap-4 border-t border-border-default pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs tracking-wide text-text-muted">{settings.footerText ?? t("copyright")}</p>
          <p className="max-w-lg text-xs leading-relaxed text-text-faint">{t("description")}</p>
        </div>
      </div>

      {/* 收束水印：超大淡金字，只露出上半截 */}
      <div
        aria-hidden
        className="foil-text-static pointer-events-none select-none whitespace-nowrap text-center font-display text-[18vw] font-light leading-[0.7] tracking-tightest opacity-[0.05]"
        style={{ marginBottom: "-6vw" }}
      >
        CHART-IX
      </div>
    </footer>
  );
}
