import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function LearnHub({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "learn" });

  const sections = [
    { key: "videos", href: `/${locale}/videos` },
    { key: "articles", href: `/${locale}/articles` },
    { key: "news", href: `/${locale}/news` },
  ] as const;

  return (
    <>
      <h1 className="font-display text-3xl tracking-tighter text-text-primary font-bold">{t("hub_title")}</h1>
      <p className="mt-2 text-sm text-text-secondary">{t("hub_subtitle")}</p>

      {/* 三个分区入口用发丝线台账列表，不做卡片堆叠 */}
      <ul className="mt-8 divide-y divide-border-default border-y border-border-default">
        {sections.map((section) => (
          <li key={section.key}>
            <Link
              href={section.href}
              className="flex min-h-[64px] items-center justify-between gap-4 px-1 py-4 transition-colors active:bg-bg-tertiary"
            >
              <span>
                <span className="block text-base text-text-primary">{t(`hub_${section.key}`)}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {t(`hub_${section.key}_desc`)}
                </span>
              </span>
              <svg
                className="h-4 w-4 shrink-0 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
