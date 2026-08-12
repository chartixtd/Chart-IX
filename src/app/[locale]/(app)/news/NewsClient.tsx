"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { NewsItem, NewsLang } from "@/types";
import { Icon } from "@/components/ui/Icon";

interface NewsClientProps {
  initialItems: NewsItem[];
  fetchError: string | null;
  lang: NewsLang;
}

// 跟服务端 TTL 缓存对齐：源大概 5 分钟刷新一次，客户端更勤地轮询也拿不到新数据
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
    return new Intl.DateTimeFormat(localeStr, { year: "numeric", month: "short", day: "numeric" }).format(
      new Date(ms)
    );
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

export default function NewsClient({ initialItems, fetchError: initialError, lang }: NewsClientProps) {
  const locale = useLocale();
  const t = useTranslations("news");
  const [items, setItems] = useState(initialItems);
  const [fetchError, setFetchError] = useState(initialError);

  // 客户端定期轮询 /api/news，让页面开着的时候能自动看到新文章，不用手动刷新
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
        // 轮询失败静默跳过，继续展示上一份数据，别用报错打断阅读
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [lang]);

  if (fetchError && items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <h1 className="text-3xl font-bold text-text-primary font-display tracking-tight">{t("title")}</h1>
        <div className="mt-8">
          <EmptyState
            icon={<Icon name="alert" className="h-6 w-6" />}
            title={t("fetch_error_title")}
            description={fetchError}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text-primary font-display tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t("subtitle")}</p>
        </div>
      </div>

      {/* News grid */}
      {items.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
            >
              <Card hover padding="none" className="overflow-hidden">
                {/* Cover image */}
                <div className="relative aspect-video bg-bg-tertiary">
                  {item.imageUrl ? (
                    // unoptimized: images come from arbitrary third-party news
                    // sources, not a fixed set of allowlisted hosts — Next's
                    // optimizer requires each remote host to be explicitly
                    // configured in next.config.mjs, which isn't practical for
                    // an aggregated feed. Still gets Image's built-in layout/
                    // CLS handling, just skips the optimization proxy.
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-text-muted">
                      <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="font-medium text-text-primary transition-colors group-hover:text-gold line-clamp-2">
                    {item.title}
                  </h3>
                  {item.summary && (
                    <p className="mt-1.5 text-sm text-text-secondary line-clamp-2">{item.summary}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
                    <span>{formatRelativeTime(item.publishedAt, locale, t)}</span>
                  </div>
                </div>
              </Card>
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState icon={<Icon name="news" className="h-6 w-6" />} title={t("no_news")} />
        </div>
      )}
    </div>
  );
}
