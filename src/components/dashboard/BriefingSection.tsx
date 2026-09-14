"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useDailyBriefings } from "@/hooks/useDashboardData";
import { Skeleton } from "@/components/ui/Skeleton";
import { DashSection, DashNote } from "./Section";
import type { Locale } from "@/types";

/**
 * `2026-09-13` → `13 SEP`。
 *
 * 手写而不是走 Intl：这一列是**刻度**，三行必须等宽对齐，而 Intl 在不同语言
 * 下给出的长度不一（中文「9月13日」、马来文「13 Sep」）。日期本身是 UTC+8 的
 * 日历日（见 briefing/date.ts），直接切字符串，不经过 Date——`new Date("2026-09-13")`
 * 会按 UTC 解析，在东八区的深夜会把日期读成前一天。
 */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  const index = Number(month) - 1;
  if (!date || index < 0 || index > 11) return day;
  return `${Number(date)} ${MONTHS[index]}`;
}

/**
 * 每日早报。按时间读的流水 → 台账，不是卡片墙。
 * 左列等宽日期是尺，右边是标题；两列之间不画线，靠对齐。
 */
export function BriefingSection() {
  const locale = useLocale() as Locale;
  const t = useTranslations("dashboard");
  const { data: briefings, isPending } = useDailyBriefings(3);

  return (
    <DashSection
      title={t("briefing_title")}
      action={
        <Link
          href={`/${locale}/articles`}
          className="shrink-0 text-[13px] text-gold transition-colors hover:text-gold-hover"
        >
          {t("briefing_cta")}
        </Link>
      }
    >
      {isPending ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : !briefings?.length ? (
        <DashNote>{t("briefing_empty")}</DashNote>
      ) : (
        <ul className="flex flex-col">
          {briefings.map((item) => (
            <li key={item.slug}>
              <Link
                href={`/${locale}/articles/${item.slug}`}
                className="group block border-b border-border-default py-3.5 last:border-b-0"
              >
                <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-text-faint">
                  {formatDay(item.day)}
                </span>
                <span className="mt-1.5 block text-[13px] leading-relaxed text-text-secondary transition-colors group-hover:text-text-primary">
                  {item.title[locale] ?? item.title["en-US"]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashSection>
  );
}
