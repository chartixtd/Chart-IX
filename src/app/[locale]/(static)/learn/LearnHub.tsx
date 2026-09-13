"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLearnProgress, type VideoProgressRow } from "@/hooks/useLearnProgress";
import { formatRelativeMs } from "@/lib/format/relative-time";
import { cn } from "@/lib/utils";
import type { Locale, VideoCategory } from "@/types";

/** 学习中心只需要视频的这几个字段——storage_url / description 一律不拉 */
export interface LearnLesson {
  id: string;
  title: Record<Locale, string>;
  category_id: number | null;
  duration_seconds: number;
  tier_required: "free" | "pro";
}

export interface LearnHubProps {
  categories: VideoCategory[];
  /** 已按 sort_order 排好。分类内的先后直接沿用这个顺序 */
  lessons: LearnLesson[];
  latestArticle: { slug: string; title: string } | null;
}

type CourseState = "done" | "progress" | "new" | "locked";

interface Course {
  category: VideoCategory;
  lessons: LearnLesson[];
  done: number;
  state: CourseState;
}

/* ────────────────────────────────────────────────────────────────────────
   小原语
   ──────────────────────────────────────────────────────────────────── */

/**
 * 进度环。挂载时从 0 画到当前进度——与 GoldChart 的曲线、扫描表盘的金弧
 * 是同一个手势（stroke-dashoffset），说的是「这是你走出来的，不是一个静态数」。
 * `prefers-reduced-motion` 由 globals.css 全局停掉。
 */
function ProgressRing({ percent, size = 64 }: { percent: number; size?: number }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#6B5322" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#D3B26A"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          style={{ animation: "ring-draw 1.2s cubic-bezier(0.16,1,0.3,1) both" }}
        />
      </svg>
      <span className="numeral absolute text-[0.9375rem] leading-none text-gold">{clamped}%</span>
      <style>{`@keyframes ring-draw{from{stroke-dashoffset:${c}}}`}</style>
    </span>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M9 6.2 18.2 12 9 17.8z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 资讯那一行要回答两件事：最近一条多新、24 小时内来了几条。
 *
 * 走客户端而不是随页面静态发下来：`getNewsPayload` 内部的 fetch 是 no-store，
 * 在服务端组件里调用会让整个 /learn 掉出静态渲染，而那个错误被 catch 吞掉
 * 之后，这一行会永远拿到空数组——页面看起来是好的，只是时间与条数永远不出现。
 * `/api/news` 自带 5 分钟 TTL 缓存，所以这一次请求基本都是读缓存。
 *
 * 顺带解决了相对时间的水合问题：「3 小时前」只在客户端算，不存在服务端与
 * 客户端算出不同结果的可能。
 */
function useNewsSummary(lang: "zh" | "en") {
  const { data } = useQuery({
    queryKey: ["learn", "news", lang],
    queryFn: async (): Promise<{ publishedAt: number }[]> => {
      const res = await fetch(`/api/news?lang=${lang}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "API error");
      return json.data as { publishedAt: number }[];
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    if (!data?.length) return { latestAt: null as number | null, recentCount: 0 };
    const now = Date.now();
    return {
      latestAt: Math.max(...data.map((item) => item.publishedAt)),
      recentCount: data.filter((item) => now - item.publishedAt < DAY_MS).length,
    };
  }, [data]);
}

/* ────────────────────────────────────────────────────────────────────────
   学习中心
   ──────────────────────────────────────────────────────────────────── */

/**
 * 学习中心。构图是一条从「你现在在哪」到「还有什么」的路径：
 *
 *   抬头（标题 + 总进度）→ 一张「继续学习」→ 课程横向卡带 → 文章与资讯的台账
 *
 * 上一版是三张等宽卡片横排（课程 / 文章 / 资讯），三扇门同一个音量，
 * 读起来是一个目录而不是一段进度。这一版把「你看到哪了」放在最前面——
 * 打开这一页的人九成是回来接着看的，不是来重新挑一扇门的。
 *
 * 数据分两层：课程目录是公开的、静态的，由服务端随页面一起发下来；
 * 观看进度是每个人自己的、受 RLS 约束的，挂载后在客户端补上。
 * 所以这一页在拿到进度之前就已经是完整可读的——课程、文章、资讯全在，
 * 只有进度相关的几处在等数据。
 */
export function LearnHub({ categories, lessons, latestArticle }: LearnHubProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("learn");
  const tNews = useTranslations("news");
  const auth = useAuth();

  const news = useNewsSummary(locale === "zh-CN" ? "zh" : "en");
  const { data: progressRows } = useLearnProgress(auth.userId);
  const isGuest = !auth.loading && !auth.userId;
  const isPro = auth.tier === "pro";

  const progress = useMemo(() => {
    const map = new Map<string, VideoProgressRow>();
    for (const row of progressRows ?? []) map.set(row.video_id, row);
    return map;
  }, [progressRows]);

  const lessonsByCategory = useMemo(() => {
    const map = new Map<number, LearnLesson[]>();
    for (const lesson of lessons) {
      if (lesson.category_id == null) continue;
      const bucket = map.get(lesson.category_id);
      if (bucket) bucket.push(lesson);
      else map.set(lesson.category_id, [lesson]);
    }
    return map;
  }, [lessons]);

  const courses: Course[] = useMemo(() => {
    return categories
      .map((category) => {
        const own = lessonsByCategory.get(category.id) ?? [];
        const done = own.filter((l) => progress.get(l.id)?.completed).length;
        // 一门课只有在「整门都要 Pro 而你是免费档」时才算锁住。只要有一节
        // 是免费的，这门课就是能开始的——锁一门你其实能看一半的课是在撒谎。
        const locked = !isPro && own.length > 0 && own.every((l) => l.tier_required === "pro");
        const state: CourseState = locked
          ? "locked"
          : own.length > 0 && done === own.length
            ? "done"
            : done > 0
              ? "progress"
              : "new";
        return { category, lessons: own, done, state };
      })
      .filter((course) => course.lessons.length > 0);
  }, [categories, lessonsByCategory, progress, isPro]);

  const totals = useMemo(() => {
    const total = lessons.length;
    const done = lessons.filter((l) => progress.get(l.id)?.completed).length;
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  }, [lessons, progress]);

  /**
   * 抬头那张卡指向哪一课。
   *   已登录且有没看完的 → 最近动过的那一节（progressRows 已按 updated_at 倒序）
   *   已登录但还没开始   → 第一节，标题换成「从这里开始」
   * 两者是同一张卡，不是「有进度才出现的卡」——没开始的人更需要一个入口。
   */
  const resume = useMemo(() => {
    if (!lessons.length) return null;

    let lesson: LearnLesson | undefined;
    let watched = 0;
    for (const row of progressRows ?? []) {
      if (row.completed) continue;
      const found = lessons.find((l) => l.id === row.video_id);
      if (found) {
        lesson = found;
        watched = row.progress_seconds;
        break;
      }
    }

    const started = !!lesson;
    if (!lesson) lesson = lessons[0];

    const siblings = lesson.category_id != null ? (lessonsByCategory.get(lesson.category_id) ?? []) : [];
    const category = categories.find((c) => c.id === lesson.category_id);
    const remaining = Math.max(0, lesson.duration_seconds - watched);

    return {
      started,
      lesson,
      course: category ? (category.name[locale] ?? category.slug) : "",
      index: Math.max(1, siblings.findIndex((l) => l.id === lesson.id) + 1),
      total: siblings.length || 1,
      minutes: Math.max(1, Math.ceil(remaining / 60)),
    };
  }, [lessons, progressRows, lessonsByCategory, categories, locale]);

  return (
    <>
      {/* ── 抬头：标题在左，总进度在右。不居中 ── */}
      <header>
        {/* 总进度压在标题那一行的右端，不另起一行——它是这一页的读数，
            不是一条独立的信息 */}
        <div className="flex items-baseline justify-between gap-5">
          <h1 className="display text-display-lg text-text-primary">{t("hub_title")}</h1>
          {!isGuest && totals.total > 0 && (
            <p className="numeral shrink-0 text-[15px] text-gold lg:text-lg">
              {t("progress_complete", { percent: totals.percent })}
            </p>
          )}
        </div>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-text-secondary">
          {t("hub_subtitle")}
        </p>
      </header>

      {/* ── 继续学习 / 从这里开始 / 访客提示 ── */}
      {isGuest ? (
        <section className="ink mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-xl p-6 lg:p-7">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-medium text-text-primary">{t("guest_prompt")}</h2>
            <p className="mt-1.5 max-w-prose text-sm text-text-secondary">{t("guest_desc")}</p>
          </div>
          <Link
            href={`/${locale}/login`}
            className="shrink-0 rounded-sm border border-gold/45 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-gold transition-colors hover:border-gold active:scale-[0.98]"
          >
            {t("guest_cta")}
          </Link>
        </section>
      ) : resume ? (
        <Link
          href={`/${locale}/videos/${resume.lesson.id}`}
          className="ink ink-hover mt-8 flex items-center gap-5 rounded-xl p-5 lg:gap-7 lg:p-7"
        >
          <ProgressRing percent={resume.started ? totals.percent : 0} />
          <span className="min-w-0 flex-1">
            <span className="eyebrow-gold block">
              {t(resume.started ? "resume_eyebrow" : "start_eyebrow")}
            </span>
            <span className="mt-2 block truncate font-display text-lg font-medium tracking-tight text-text-primary lg:text-xl">
              {resume.lesson.title[locale] ?? resume.lesson.title["en-US"]}
            </span>
            {/* 这一行在窄屏上必然放不下（课程名 + 第几课 + 还剩几分钟），
                让它折成两行，不要截断——被截掉的正是「还剩多久」 */}
            <span className="mt-1.5 block text-[13px] leading-relaxed text-text-muted">
              {t(resume.started ? "resume_meta" : "start_meta", {
                course: resume.course,
                index: resume.index,
                total: resume.total,
                minutes: resume.minutes,
              })}
            </span>
          </span>
          <Icon name="arrowRight" className="hidden h-4 w-4 shrink-0 text-gold sm:block" />
        </Link>
      ) : null}

      {/* ── 课程卡带 ── */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="section-mark font-display text-display-sm font-light text-text-primary">
            {t("hub_videos")}
          </h2>
          <Link
            href={`/${locale}/videos`}
            className="shrink-0 text-[13px] text-gold transition-colors hover:text-gold-hover"
          >
            {t("see_all")}
          </Link>
        </div>

        {courses.length === 0 ? (
          <div className="mt-6 border-t border-border-default pt-6">
            <p className="font-display text-base text-text-secondary">{t("empty_courses")}</p>
            <p className="mt-1.5 max-w-prose text-sm text-text-muted">{t("empty_courses_desc")}</p>
          </div>
        ) : (
          // 负外边距 + 内补白：卡带贴着页面左右边缘滚，但第一张与最后一张
          // 仍与正文对齐。手机上这是「还有更多」唯一诚实的表达方式。
          <ul className="custom-scrollbar -mx-6 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2">
            {courses.map((course) => (
              <li key={course.category.id} className="w-[168px] shrink-0 snap-start lg:w-[200px]">
                <CourseCard course={course} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 文章与资讯：流水内容用台账，不用卡片 ── */}
      <ul className="mt-12 divide-y divide-border-default border-y border-border-default">
        <li>
          <Link
            href={`/${locale}/articles`}
            className="group flex items-center gap-4 py-5 transition-colors hover:bg-bg-secondary/40"
          >
            <Icon name="article" className="h-5 w-5 shrink-0 text-text-muted transition-colors group-hover:text-gold" />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-medium text-text-primary">
                {t("hub_articles")}
              </span>
              <span className="mt-1 block truncate text-[13px] text-text-muted">
                {latestArticle ? latestArticle.title : t("articles_empty")}
              </span>
            </span>
            <Icon
              name="arrowRight"
              className="h-3.5 w-3.5 shrink-0 text-text-faint transition-all duration-500 ease-out group-hover:translate-x-1 group-hover:text-gold"
            />
          </Link>
        </li>
        <li>
          <Link
            href={`/${locale}/news`}
            className="group flex items-center gap-4 py-5 transition-colors hover:bg-bg-secondary/40"
          >
            <Icon name="news" className="h-5 w-5 shrink-0 text-text-muted transition-colors group-hover:text-gold" />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-medium text-text-primary">
                {t("hub_news")}
              </span>
              <span className="mt-1 block truncate text-[13px] text-text-muted">
                {/* 资讯还没到位时先说这一栏是什么，不留一行空 */}
                {news.latestAt
                  ? t("news_updated", { time: formatRelativeMs(news.latestAt, locale, tNews) })
                  : t("hub_news_desc")}
              </span>
            </span>
            {news.recentCount > 0 && (
              <span className="shrink-0 whitespace-nowrap rounded-sm border border-gold/40 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-gold">
                {t("news_recent", { count: news.recentCount })}
              </span>
            )}
            <Icon
              name="arrowRight"
              className="h-3.5 w-3.5 shrink-0 text-text-faint transition-all duration-500 ease-out group-hover:translate-x-1 group-hover:text-gold"
            />
          </Link>
        </li>
      </ul>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   课程卡
   ──────────────────────────────────────────────────────────────────── */

function CourseCard({ course, locale }: { course: Course; locale: Locale }) {
  const t = useTranslations("learn");
  const { category, lessons, done, state } = course;
  const total = lessons.length;

  return (
    <Link
      href={`/${locale}/videos?category=${category.slug}`}
      className={cn(
        "ink ink-hover group flex h-full flex-col overflow-hidden rounded-xl",
        state === "locked" && "opacity-60"
      )}
    >
      {/* 状态面：一个大字符说清这门课对你是什么状态 */}
      <span
        className={cn(
          "flex h-24 items-center justify-center border-b border-border-default lg:h-28",
          state === "done" && "bg-success-bg",
          state === "progress" && "bg-[rgba(211,178,106,0.07)]"
        )}
      >
        {state === "done" && <Icon name="check" className="h-7 w-7 text-success" />}
        {state === "progress" && <PlayGlyph className="h-7 w-7 text-gold" />}
        {state === "new" && <PlayGlyph className="h-7 w-7 text-text-muted" />}
        {state === "locked" && <Icon name="lock" className="h-6 w-6 text-text-faint" />}
      </span>

      <span className="flex flex-1 flex-col gap-2 p-4">
        <span className="line-clamp-2 font-display text-[15px] font-medium leading-snug tracking-tight text-text-primary">
          {category.name[locale] ?? category.slug}
        </span>

        {state === "progress" && (
          <>
            {/* 进度条只动 transform：scaleX 不触发重排 */}
            <span aria-hidden className="mt-auto block h-[2px] w-full bg-border-default">
              <span
                className="block h-full origin-left bg-gold"
                style={{ transform: `scaleX(${total ? done / total : 0})` }}
              />
            </span>
            <span className="text-xs text-gold">{t("course_progress", { done, total })}</span>
          </>
        )}

        {state === "done" && (
          <span className="mt-auto text-xs text-success">
            {t("course_done")} · {t("course_lessons", { count: total })}
          </span>
        )}
        {state === "new" && (
          <span className="mt-auto text-xs text-text-muted">{t("course_lessons", { count: total })}</span>
        )}
        {state === "locked" && <span className="mt-auto text-xs text-text-faint">{t("course_locked")}</span>}
      </span>
    </Link>
  );
}
