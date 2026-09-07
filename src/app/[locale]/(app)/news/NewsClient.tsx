"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import type { NewsItem, NewsLang } from "@/types";
import { Icon } from "@/components/ui/Icon";

interface NewsClientProps {
  initialItems: NewsItem[];
  fetchError: string | null;
  lang: NewsLang;
}

const REFRESH_MS = 5 * 60 * 1000;

function formatRelativeTime(ms: number, localeStr: string, t: ReturnType<typeof useTranslations>) {
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t("just_now");
  if (diffMin < 60) return t("minutes_ago", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("hours_ago", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t("days_ago", { count: diffDay });
  try {
    return new Intl.DateTimeFormat(localeStr, { year: "numeric", month: "short", day: "numeric" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

/**
 * 行业资讯（Read 面）。资讯是按时间读的流水——所以是台账，不是卡片墙：
 * 左侧等宽时间戳，中间标题与摘要，右侧一张小图。
 */
export default function NewsClient({ initialItems, fetchError: initialError, lang }: NewsClientProps) {
  const locale = useLocale();
  const t = useTranslations("news");
  const [items, setItems] = useState(initialItems);
  const [fetchError, setFetchError] = useState(initialError);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/news?lang=${lang}`, { cache: "no-store" });
        const json = await res.json();
        if (json.success) {
          setItems(json.data as NewsItem[]);
          setFetchError(null);
        }
      } catch {
        // 轮询失败静默跳过
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [lang]);

  if (fetchError && items.length === 0) {
    return (
      <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
        <PageHeader title={t("title")} />
        <div className="mt-8">
          <EmptyState icon={<Icon name="alert" className="h-6 w-6" />} title={t("fetch_error_title")} description={fetchError} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {items.length > 0 ? (
        <ul className="divide-y divide-border-default">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group grid gap-4 py-7 sm:grid-cols-12 sm:items-start sm:gap-6"
              >
                <span className="font-mono text-[11px] tabular-nums text-text-muted sm:col-span-2 sm:pt-1.5">
                  {formatRelativeTime(item.publishedAt, locale, t)}
                </span>
                <div className="min-w-0 sm:col-span-7">
                  <h3 className="font-display text-lg font-medium leading-snug tracking-tight text-text-primary transition-colors group-hover:text-gold lg:text-xl">
                    {item.title}
                  </h3>
                  {item.summary && (
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary line-clamp-2">{item.summary}</p>
                  )}
                </div>
                <div className="relative hidden aspect-[3/2] overflow-hidden rounded-md border border-border-default bg-bg-tertiary sm:col-span-3 sm:block">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      unoptimized
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                      sizes="(min-width: 640px) 25vw, 100vw"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-text-faint">
                      <Icon name="news" className="h-6 w-6" />
                    </div>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8">
          <EmptyState icon={<Icon name="news" className="h-6 w-6" />} title={t("no_news")} />
        </div>
      )}
    </div>
  );
}
