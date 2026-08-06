import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { buildLanguageAlternates } from "@/lib/seo";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { LearningPath } from "@/types";
import { LearnHub } from "./LearnHub";

const LEVEL_VARIANT: Record<string, "gold" | "blue" | "orange"> = {
  beginner: "gold",
  intermediate: "blue",
  advanced: "orange",
};

// Public catalog data (same is_published-filtered read as sitemap.ts) — no
// per-user auth check here, so this doesn't need the cookie-bound server
// client. Using the plain service-role client instead keeps this page free
// of Next's dynamic-API opt-out, so `revalidate` below actually applies.
export const revalidate = 300;

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

  const [{ data: paths }, { data: steps }] = await Promise.all([
    supabase
      .from("learning_paths")
      .select("*")
      .eq("is_published", true)
      .order("sort_order", { ascending: true })
      .limit(100),
    supabase.from("learning_path_steps").select("path_id"),
  ]);

  const stepCounts = new Map<number, number>();
  for (const s of (steps ?? []) as { path_id: number }[]) {
    stepCounts.set(s.path_id, (stepCounts.get(s.path_id) ?? 0) + 1);
  }

  const list = (paths ?? []) as LearningPath[];

  const tLearn = await getTranslations({ locale, namespace: "learn" });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:py-12">
      <LearnHub locale={locale} />

      <h2 id="paths" className="mt-12 scroll-mt-20 font-display text-2xl tracking-tighter text-text-primary">
        {tLearn("hub_paths")}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">{tLearn("hub_paths_desc")}</p>

      {list.length === 0 ? (
        <p className="mt-8 text-text-muted">学习路径即将上线，敬请期待。</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((path) => {
            const title = path.title[locale as keyof typeof path.title] ?? path.title["en-US"];
            const desc = path.description?.[locale as keyof typeof path.description] ?? path.description?.["en-US"];
            return (
              <Link key={path.id} href={`/${locale}/learn/${path.slug}`}>
                <Card hover className="h-full">
                  <div className="flex items-center justify-between">
                    <Badge variant={LEVEL_VARIANT[path.level] ?? "gray"}>{path.level}</Badge>
                    <span className="text-xs text-text-muted">{stepCounts.get(path.id) ?? 0} 课</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-text-primary">{title}</h3>
                  {desc && <p className="mt-1.5 text-sm text-text-secondary line-clamp-2">{desc}</p>}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
