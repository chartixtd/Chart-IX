import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { ArticlesManager } from "./ArticlesManager";
import { ArticlesHeading } from "./ArticlesHeading";

export const dynamic = "force-dynamic";

export default async function AdminArticlesPage() {
  const client = createServiceRoleClient();

  const [articlesRes, categoriesRes] = await Promise.all([
    client.from("articles").select("*, category:article_categories(id, name, slug)").order("created_at", { ascending: false }),
    client.from("article_categories").select("*").order("sort_order", { ascending: true }),
  ]);

  const articles = articlesRes.data ?? [];
  const categories = categoriesRes.data ?? [];
  const error = articlesRes.error?.message ?? categoriesRes.error?.message ?? null;

  return (
    <div>
      <ArticlesHeading />
      {error ? (
        <div className="text-danger">Failed to load articles.</div>
      ) : (
        <ArticlesManager articles={articles} categories={categories} />
      )}
    </div>
  );
}
