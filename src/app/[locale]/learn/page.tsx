import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { LearningPath } from "@/types";

const LEVEL_VARIANT: Record<string, "gold" | "blue" | "orange"> = {
  beginner: "gold",
  intermediate: "blue",
  advanced: "orange",
};

export default async function LearnPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();

  const [{ data: paths }, { data: steps }] = await Promise.all([
    supabase
      .from("learning_paths")
      .select("*")
      .eq("is_published", true)
      .order("sort_order", { ascending: true }),
    supabase.from("learning_path_steps").select("path_id"),
  ]);

  const stepCounts = new Map<number, number>();
  for (const s of (steps ?? []) as { path_id: number }[]) {
    stepCounts.set(s.path_id, (stepCounts.get(s.path_id) ?? 0) + 1);
  }

  const list = (paths ?? []) as LearningPath[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-3xl font-bold text-text-primary">学习路径</h1>
      <p className="mt-2 text-text-secondary">循序渐进，从零开始系统化学习交易</p>

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
