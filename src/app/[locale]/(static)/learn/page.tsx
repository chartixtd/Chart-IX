import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { buildLanguageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { LearnHub, type LearnLesson } from "./LearnHub";
import type { Locale, VideoCategory } from "@/types";

/**
 * 课程目录与最新文章是公开数据，跟着页面一起静态发下来。另外两样在客户端补：
 *   - **观看进度**：每个人自己的，受 RLS 约束；
 *   - **行业资讯**：`getNewsPayload` 内部的 fetch 是 no-store，在服务端组件里
 *     调用会让整个 /learn 掉出静态渲染（构建日志里的 Dynamic server usage
 *     就是它），而那个错误被 catch 吞掉之后，资讯那一行会永远拿到空数组——
 *     页面看起来是好的，只是那一行的时间与条数永远不出现。它改走 /api/news。
 *
 * 用普通的 service-role client 而不是绑 cookie 的那个：读 cookie 同样会让这一页
 * 掉出静态渲染，下面的 revalidate 就不再生效（与 videos 页同理）。
 */
export const revalidate = 300;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "learn" });
  return { title: t("hub_title"), alternates: { languages: buildLanguageAlternates("/learn") } };
}

export default async function LearnPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = createServiceRoleClient();

  const [lessonsRes, catsRes, articleRes] = await Promise.all([
    supabase
      .from("videos")
      .select("id, title, category_id, duration_seconds, tier_required")
      .eq("is_deleted", false)
      .eq("language", locale)
      .order("sort_order", { ascending: true })
      // sort_order 相同时必须有稳定的次级排序，否则「第 4 / 9 课」这个序号
      // 会在两次刷新之间自己变（与 videos 页同一条理由）
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("video_categories").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("articles")
      .select("slug, title")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const article = articleRes.data as { slug: string; title: Record<Locale, string> } | null;

  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
      <LearnHub
        categories={(catsRes.data as VideoCategory[]) ?? []}
        lessons={(lessonsRes.data as unknown as LearnLesson[]) ?? []}
        latestArticle={
          article
            ? { slug: article.slug, title: article.title[locale as Locale] ?? article.title["en-US"] }
            : null
        }
      />
    </div>
  );
}
