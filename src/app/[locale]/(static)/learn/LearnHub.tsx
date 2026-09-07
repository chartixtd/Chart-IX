import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * 学习中心：三扇门。每一扇是一段带编号的墨面，悬停时描边变金。
 */
export async function LearnHub({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "learn" });

  const sections: { key: "videos" | "articles" | "news"; href: string; icon: IconName }[] = [
    { key: "videos", href: `/${locale}/videos`, icon: "video" },
    { key: "articles", href: `/${locale}/articles`, icon: "article" },
    { key: "news", href: `/${locale}/news`, icon: "news" },
  ];

  return (
    <>
      <PageHeader title={t("hub_title")} subtitle={t("hub_subtitle")} />

      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        {sections.map((section, i) => (
          <li key={section.key}>
            <Link
              href={section.href}
              className="ink ink-hover group flex min-h-[260px] flex-col justify-between rounded-lg p-7 lg:min-h-[320px] lg:p-9"
            >
              <div className="flex items-start justify-between">
                <span className="numeral text-2xl text-gold">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-hover text-text-secondary transition-colors group-hover:border-gold/50 group-hover:text-gold">
                  <Icon name={section.icon} className="h-4.5 w-4.5" />
                </span>
              </div>
              <div>
                <h2 className="font-display text-2xl font-medium tracking-tight text-text-primary">
                  {t(`hub_${section.key}`)}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t(`hub_${section.key}_desc`)}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-gold">
                  <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform duration-500 ease-out group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
