import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";
import { buildShareExcerpt } from "@/lib/community-share";
import { CommunityPostClient } from "./CommunityPostClient";

// React 的请求级缓存：generateMetadata 和页面主体都要这条帖子，
// 不包一层就会查两次库（沿用 articles/[slug]/page.tsx 的做法）。
const getPostById = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase
    .from("community_posts")
    .select("id, title, content, cover_image")
    .eq("id", id)
    .maybeSingle();
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data: post } = await getPostById(id);

  if (!post) return {};

  const description = buildShareExcerpt(post.content) || undefined;

  // alternates 必须显式写，而且只写 canonical：
  //  · 不给 languages——那个字段意为「这几个 URL 互为翻译版本」，对文章成立
  //    （title/content 是 {locale: text} 对象），对帖子不成立：帖子是单一纯
  //    文本，三个语言前缀下是同一份内容。
  //  · 但不能干脆不写。[locale]/layout.tsx 已全局设了指向各语言首页的
  //    languages，而 Next 的 metadata 按顶层键浅合并——这里不写就会继承那份，
  //    等于宣称「本帖的其他语言版本是首页」。写了 canonical 就整体覆盖掉了，
  //    同时把三个语言前缀下的同一份内容统一指向默认语言那一个。
  return {
    title: post.title,
    description,
    alternates: { canonical: `${SITE_URL}/${routing.defaultLocale}/community/${id}` },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      images: post.cover_image ? [post.cover_image] : undefined,
    },
    twitter: { title: post.title, description },
  };
}

export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: post } = await getPostById(id);

  if (!post) notFound();

  return <CommunityPostClient postId={id} />;
}
