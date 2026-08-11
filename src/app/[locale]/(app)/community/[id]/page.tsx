import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";
import { buildShareExcerpt } from "@/lib/community-share";
import { CommunityPostClient } from "./CommunityPostClient";

// 只给 generateMetadata 用——页面主体不查库，直接渲染客户端组件（它自己
// 用 usePost 再取一份帖子数据）。这条查询在一次请求里只会被调用一次，
// 不需要额外包一层 cache() 去重。
async function getPostById(id: string) {
  const supabase = await createClient();
  return supabase
    .from("community_posts")
    .select("id, title, content, cover_image")
    .eq("id", id)
    .maybeSingle();
}

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
      images: post.cover_image ? [post.cover_image] : ["/opengraph-image"],
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

  // 帖子不存在时不主动跳裸 404——本项目没有自定义 not-found 页，那样只会
  // 渲染 Next 自带的黑白默认页。分享链接指向已删帖子是很现实的场景，站内
  // 那条带样式、带返回链接的「帖子不存在」提示（CommunityPostClient 里
  // usePost 拿到空结果后自己会显示）体验更好。代价是这种情况返回 200 而
  // 不是 404，是有意接受的取舍。
  return <CommunityPostClient postId={id} />;
}
