import { createServiceRoleClient } from "@/lib/supabase/middleware";

/**
 * 「今天这篇稿子还能不能变得更好」的唯一事实来源。
 *
 * 早报有两种发布结果：AI 正常稿，和零 AI 兜底稿（只有真实新闻标题与真实
 * 行情，没有任何 AI 判断）。兜底稿的意义是保证栏目不断更，但它显然不是
 * 我们想让读者看到的东西——而在此之前，一天只跑一次的流水线让「今天降级了」
 * 变成一个无法挽回的既成事实。
 *
 * 这条记录让高频 tick 能回答两个问题：
 * 1. 今天这篇还值不值得重新生成一次？（升级重试）
 * 2. 今天这篇算定稿了吗？（链接该不该推出去）
 *
 * 两个问题共用一条记录不是省事，是因为它们本来就是同一件事的两面：
 * 还能升级 = 还没定稿 = 先别推链接，否则读者点开的是那篇待会儿就会被
 * 替换掉的兜底稿。
 */

const KEY = "daily_briefing_publish_state";

export interface BriefingPublishState {
  slug: string;
  /** 当前已发布的那篇是不是兜底稿 */
  degraded: boolean;
  /** 已经尝试过几次升级重生成（不含首次发布） */
  attempts: number;
}

/**
 * 升级重试次数上限。
 *
 * 每次升级最多打 3 次模型（L1 同模型重试 + L2 换模型），所以 3 次上限意味着
 * 糟糕的一天最多额外烧 9 次调用。再多就不划算了：连着四轮都只能出兜底稿，
 * 说明问题不在偶发抖动，而在素材或模型本身，多试几次也是同样的结果。
 *
 * 发布窗口是 08:00–11:59（近 4 小时，10 分钟一个 tick），所以 3 次尝试在
 * 时间上绰绰有余，约束只来自成本。
 */
export const MAX_UPGRADE_ATTEMPTS = 3;

export async function readPublishState(): Promise<BriefingPublishState | null> {
  try {
    const { data } = await createServiceRoleClient()
      .from("admin_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    const v = data?.value as Partial<BriefingPublishState> | undefined;
    if (!v || typeof v.slug !== "string") return null;
    return {
      slug: v.slug,
      degraded: v.degraded === true,
      attempts: typeof v.attempts === "number" ? v.attempts : 0,
    };
  } catch (err) {
    console.error("[daily-briefing] readPublishState failed", err);
    return null;
  }
}

export async function writePublishState(state: BriefingPublishState): Promise<void> {
  try {
    await createServiceRoleClient().from("admin_settings").upsert(
      {
        key: KEY,
        value: state,
        description: "每日早报当前发布状态：是否兜底稿、已尝试升级几次（程序自动写入）",
      },
      { onConflict: "key" }
    );
  } catch (err) {
    // 写不进去不能影响已经发布成功的文章。代价是这一天失去升级重试与推送
    // 延后——退化成本次改动之前的行为，不会更糟。
    console.error("[daily-briefing] writePublishState failed", err);
  }
}

/** 今天这篇是兜底稿，且还没用完升级次数 */
export function canUpgrade(state: BriefingPublishState | null, slug: string): boolean {
  if (!state || state.slug !== slug) return false;
  return state.degraded && state.attempts < MAX_UPGRADE_ATTEMPTS;
}

/**
 * 今天这篇算定稿了吗——链接可以推出去了吗。
 *
 * 没有记录时**按定稿处理**。这条默认值是刻意的：记录可能因为写库失败、
 * 本次改动上线前就已发布、或人工在库里改过而缺失，而「拿不准就不推」会让
 * 链接永远发不出去——那正是这套机制要修的病，不能反过来变成它的新形态。
 */
export function isFinal(state: BriefingPublishState | null, slug: string): boolean {
  if (!state || state.slug !== slug) return true;
  if (!state.degraded) return true;
  return state.attempts >= MAX_UPGRADE_ATTEMPTS;
}
