import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";

/**
 * 视频库列表页的缓存失效。
 *
 * 列表页（[locale]/(static)/videos/page.tsx）设了 revalidate = 300 的静态
 * 缓存——公开目录页，缓存能省数据库查询。代价是任何改动最多 5 分钟才可见：
 * 管理员在后台拖完顺序、刷新前台却还是旧的排列，看起来就是"功能没生效"。
 * 新增和删除视频同样有这个延迟。
 *
 * 这里在**每一次视频写操作成功之后**主动失效三个语言的列表页：平时照常吃
 * 5 分钟缓存，改动瞬间立即可见。详情页是动态渲染的，不需要处理。
 *
 * 与 articles-revalidate.ts 同构；两边的取舍和坑完全一样，改一处时记得看另一处。
 *
 * try/catch 吞掉一切：revalidatePath 只能在请求上下文里调用（route handler /
 * server action），测试或未来某个脱离请求的调用方不该因为刷缓存失败而丢掉
 * 已经成功的写入——缓存失效失败的最坏结果只是回到「等 5 分钟」的旧行为。
 */
export function revalidateVideoLists(): void {
  for (const locale of routing.locales) {
    try {
      revalidatePath(`/${locale}/videos`);
    } catch (err) {
      console.error(`[videos-revalidate] failed for ${locale}`, err);
    }
  }
}
