import { createServiceRoleClient } from "@/lib/supabase/middleware";
import type { ScenarioMemo } from "./cards";

/**
 * 备忘保留多久。
 *
 * 场景锚在 7 天 K 线序列内的摆动点上，所以超过 7 天的备忘**不可能再被
 * 匹配上**（那个锚点已经滑出序列，钥匙永远对不上了）。留着只是占地方。
 *
 * 给到 8 天而不是正好 7 天，是给序列长度的边界留一点余量——刚好卡在
 * 第 7 天的备忘如果被提前清掉，那张卡会以「新事件」的身份重新计时，
 * 首次价和累计变化被无声地重置。
 */
export const MEMO_TTL_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * 读出全部备忘。
 *
 * 整表读而不是按 key 过滤：表最多几十行（同时存在的结构事件就那么多），
 * 而调用方需要的两件事——「按 key 查首次价」和「哪些币有卡片、要给它们
 * 留扫描名额」——都需要整份数据。
 *
 * 读失败返回空 Map：那一轮所有卡片都会被当成「第一次看到」，首次价重置
 * 成当前价。这是难看但安全的降级——绝不能让备忘表的故障影响到扫描本身。
 */
export async function readMemos(): Promise<Map<string, ScenarioMemo>> {
  const out = new Map<string, ScenarioMemo>();
  try {
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("screener_scenario_memo")
      .select("key, symbol, first_seen_at, first_price");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as {
        key: string;
        symbol: string;
        first_seen_at: string;
        first_price: number | string;
      };
      const price = typeof r.first_price === "number" ? r.first_price : parseFloat(r.first_price);
      if (!Number.isFinite(price)) continue;
      out.set(r.key, {
        key: r.key,
        symbol: r.symbol,
        firstSeenAt: r.first_seen_at,
        firstPrice: price,
      });
    }
  } catch (err) {
    console.error("[screener] memo read failed, all cards will look brand new", err);
  }
  return out;
}

/**
 * 写入新备忘，并顺手清掉过期的。
 *
 * 用 `ignoreDuplicates` 而不是覆盖式 upsert：备忘的全部意义就是「第一次」，
 * 覆盖等于把首次价改成现在的价——那正是这张表存在要防止的事。两个实例
 * 同时扫描时也靠它保证先写的那份赢。
 *
 * **这句话以前只写在注释里，代码是 `.insert()`。** 两者的差别不是风格：
 * 批量 insert 撞上唯一约束会整批失败，于是那一轮**所有**新备忘一条都没写进去，
 * 下一轮它们全部被当成「第一次看到」——Telegram 把已经推过的卡片再推一遍。
 * 而并发扫描是常态而非意外：pg_cron 每 5 分钟打一次 screener-scan，同时
 * 任何人打开 /screener 都可能因为 DB 缓存过期而触发一次 runScan
 * （见 cache.ts 的 computeWithDbCache）。两者撞在一起，这批就全丢了。
 *
 * 失败只记录不抛出：这一轮的卡片已经算好了，存不进备忘的后果只是下一轮
 * 它们会被当成新的，不该让整轮扫描记成失败。
 */
export async function saveMemos(memos: ScenarioMemo[], now: number): Promise<void> {
  const client = createServiceRoleClient();

  if (memos.length > 0) {
    try {
      const { error } = await client.from("screener_scenario_memo").upsert(
        memos.map((m) => ({
          key: m.key,
          symbol: m.symbol,
          first_seen_at: m.firstSeenAt,
          first_price: m.firstPrice,
        })),
        { onConflict: "key", ignoreDuplicates: true }
      );
      // supabase-js 把写失败放在返回值里，不抛异常——只包 try/catch 的话
      // 「整批没写进去」是完全静默的，而它的后果正是重复推送。
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error("[screener] memo upsert failed", err);
    }
  }

  try {
    await client
      .from("screener_scenario_memo")
      .delete()
      .lt("first_seen_at", new Date(now - MEMO_TTL_MS).toISOString());
  } catch (err) {
    console.error("[screener] memo purge failed", err);
  }
}
