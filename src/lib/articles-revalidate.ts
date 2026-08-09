import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";

/**
 * 文章列表页的缓存失效。
 *
 * 列表页（[locale]/(static)/articles/page.tsx）设了 revalidate = 300 的静态
 * 缓存——公开目录页，缓存能省数据库查询。代价是发布后最多 5 分钟才出现在
 * 列表里：后台点了「发布」、早报 cron 落了库，作者刷新页面却看不到自己的文章。
 *
 * 这里在**每一次文章写操作成功之后**主动失效三个语言的列表页：平时照常吃
 * 5 分钟缓存，发布瞬间立即可见。详情页本身是动态渲染，不需要处理。
 *
 * try/catch 吞掉一切：revalidatePath 只能在请求上下文里调用（route handler /
 * server action），测试或未来某个脱离请求的调用方不该因为刷缓存失败而丢掉
 * 已经成功的发布——缓存失效失败的最坏结果只是回到「等 5 分钟」的旧行为。
 */
export function revalidateArticleLists(): void {
  for (const locale of routing.locales) {
    try {
      revalidatePath(`/${locale}/articles`);
    } catch (err) {
      console.error(`[articles-revalidate] failed for ${locale}`, err);
    }
  }
}
