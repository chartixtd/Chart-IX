import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { logAdminAction } from "@/lib/supabase/admin-log";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { pushBriefingToTelegram } from "@/lib/briefing/telegram";

export const dynamic = "force-dynamic";
/**
 * 不能用平台默认的 10 秒：一轮投递最坏就要约 8.5 秒（2 次尝试 × 4 秒超时 +
 * 退避），再加上鉴权与取文章两次查询，默认值下必然偶发超时——而超时发生在
 * 消息已经发出去之后，管理员看到的是「推送失败」，然后再点一次，于是频道里
 * 出现两条一样的链接。
 */
export const maxDuration = 60;

/**
 * 后台「立即推送早报链接」。
 *
 * 补的是一个真空：早报推送只在流水线发布成功的那一刻触发，而发布一天只有
 * 一次、还卡在 UTC+8 08:00–11:59 的窗口里。于是勾好「每日早报」的目标在
 * 后台会一直显示「从未成功投递」，管理员想确认配置对不对，唯一的办法是等
 * 到第二天早上，或者点「删除今天这篇并重新生成」——为验证一条链接付出一次
 * 完整的模型调用和一篇被替换掉的文章，代价离谱。
 *
 * 这个路由只做投递，**不碰文章**：取最近一篇已发布的早报，把它的链接按
 * 目标语言推出去。今天的稿子出来之后取到的就是今天那篇，所以它同时也是
 * 「早上那条没发出去，补一条」的补发入口。
 *
 * 目标筛选、语言、话题、失败记账全部走 pushBriefingToTelegram，与 cron
 * 路径完全同一套代码——这里验证通过，明早自动推送就一定是同样的结果。
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { data, error } = await createServiceRoleClient()
      .from("articles")
      .select("slug, title")
      .like("slug", "daily-briefing-%")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    // 一篇早报都还没有：这不是故障，是还没开始出稿，得让管理员一眼看懂
    if (!data) return NextResponse.json({ error: "no_article" }, { status: 400 });

    const slug = data.slug as string;
    const titles = (data.title ?? {}) as Record<string, string>;
    const outcome = await pushBriefingToTelegram(slug, titles);

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "push_briefing_telegram",
        targetType: "setting",
        targetId: slug,
        oldValue: null,
        newValue: { slug, skippedReason: outcome.skippedReason ?? null },
      });
    } catch {
      // 记日志失败不该影响响应
    }

    return NextResponse.json({
      // 跳过（总开关关着、没目标、没 token）不是成功——那三种情况下
      // 一条消息都没发出去，报成功只会让人以为配好了
      success: !outcome.skippedReason && outcome.results.some((r) => r.ok),
      slug,
      skippedReason: outcome.skippedReason,
      targets: outcome.results.map((r) => ({
        label: r.label,
        ok: r.ok,
        attempts: r.attempts,
        error: r.error,
      })),
    });
  } catch (err) {
    console.error("[admin/briefing/push-telegram]", err);
    return NextResponse.json({ error: "Push failed" }, { status: 500 });
  }
}
